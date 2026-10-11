import * as nodePath from "node:path"
import type { ApiHandler } from "@core/api"
import { ClineStorageMessage } from "@shared/messages/content"
import { ClineDefaultTool } from "@shared/tools"
import type { StateManager } from "@/core/storage/StateManager"
import type { TaskState } from "@/core/task/TaskState"
import { EDU_DIR_NAME, getEduDirPath } from "./eduDataFiles"

/**
 * 教育防护子 Agent（Educational Guardrail Reviewer）
 *
 * Cline Chinese Edu 中「自动批准」功能全开且无 UI：
 * 主 Agent 的每个受管控工具操作在执行前由本子 Agent 审核，
 * 只有与学生学习任务直接相关的操作才会被批准并自动执行，
 * 否则直接拒绝（并附带原因反馈给主 Agent），不回落到人工确认。
 *
 * 判定分三层：
 * 1. 快速通道（零时延）：只读工具访问工作区内文件、
 *    写 `.cline-chinese-edu/` 内部学习数据文件 → 直接批准。
 * 2. LLM 审核（复用任务主模型，单次轻量调用）：写文件、执行命令、
 *    网络请求、浏览器、MCP 等 → 由模型判断是否与学习相关。
 * 3. 失败兜底：LLM 调用失败 / 输出无法解析 → 一律拒绝（安全默认）。
 */

/** 传给审核器的操作细节（由各工具 handler 提供） */
export interface EduGuardrailDetail {
	/** 待执行命令（execute_command） */
	command?: string
	/** 目标 URL（web_fetch / browser） */
	url?: string
	/** 搜索词（web_search） */
	searchQuery?: string
	/** MCP server / tool / 参数摘要 */
	mcpServer?: string
	mcpTool?: string
	mcpArguments?: string
	/** MCP resource uri */
	mcpResourceUri?: string
	/** 浏览器动作 */
	browserAction?: string
	/** 目标文件路径（相对或绝对） */
	filePath?: string
}

/**
 * 审核结论：
 * - approved：子 Agent 批准，工具直接自动执行（无需任何 UI）
 * - rejected：子 Agent 拒绝，工具不执行，原因返回给主 Agent
 * - manual：仅当防护关闭时（遗留设置逻辑），回落到旧的确认流程
 */
export type EduGuardrailDecision =
	| { status: "approved"; reason?: string }
	| { status: "rejected"; reason: string }
	| { status: "manual" }

export interface EduGuardrailReviewerDeps {
	stateManager: StateManager
	api: ApiHandler
	taskState: TaskState
	cwd: string
}

const READ_ONLY_TOOLS: ClineDefaultTool[] = [
	ClineDefaultTool.FILE_READ,
	ClineDefaultTool.LIST_FILES,
	ClineDefaultTool.LIST_CODE_DEF,
	ClineDefaultTool.SEARCH,
]

const WRITE_TOOLS: ClineDefaultTool[] = [
	ClineDefaultTool.FILE_NEW,
	ClineDefaultTool.FILE_EDIT,
	ClineDefaultTool.APPLY_PATCH,
	ClineDefaultTool.NEW_RULE,
]

function describeOperation(toolName: string, path: string | undefined, detail?: EduGuardrailDetail): string {
	const parts: string[] = []
	if (detail?.command) parts.push(`command: ${detail.command}`)
	if (detail?.url) parts.push(`url: ${detail.url}`)
	if (detail?.searchQuery) parts.push(`search: ${detail.searchQuery}`)
	if (detail?.browserAction) parts.push(`browser_action: ${detail.browserAction}`)
	if (detail?.mcpServer) parts.push(`mcp_server: ${detail.mcpServer}`)
	if (detail?.mcpTool) parts.push(`mcp_tool: ${detail.mcpTool}`)
	if (detail?.mcpArguments) parts.push(`mcp_arguments: ${detail.mcpArguments.slice(0, 500)}`)
	if (detail?.mcpResourceUri) parts.push(`mcp_resource_uri: ${detail.mcpResourceUri}`)
	if (path && !parts.length) parts.push(`path: ${path}`)
	if (!parts.length && detail?.filePath) parts.push(`path: ${detail.filePath}`)
	return parts.length ? parts.join("\n") : "（无额外参数）"
}

function buildReviewerSystemPrompt(lastUserText: string): string {
	return `# 角色
你是「Cline Chinese Edu」中的教育防护子 Agent。主 Agent 正在辅导一名学生，它每一次调用工具操作（读文件、写文件、执行命令、网络请求、浏览器、MCP 等）都需要你审核：该操作是否与当前学生的学习任务直接相关。

# 批准标准（满足其一即可批准）
1. 操作明显服务于回答 / 讲解 / 练习 / 作业：例如读取工作区内的学习资料、讲义、题目文件；搜索题目、知识点、解题方法；抓取与题目或知识内容相关的网页。
2. 操作是维护学习数据本身：读写工作区根目录下 .cline-chinese-edu/ 内的学习记录文件（progress.json、mistake.json、profile.json）。
3. 操作是为学习做计算或验证：例如运行一个明确的计算脚本 / 代码来验算答案。
4. 操作写入的文件是学生作业、练习卷、讲义等学习产物（位于工作区内）。

# 拒绝标准（满足其一即拒绝）
1. 与教学和学习无关：系统维护、shell 环境操作、修改与教学无关的代码或配置、安装依赖、git 操作等。
2. 无法确认操作是为当前学生的学习目标服务。
3. 操作可能泄露学习数据或访问与学习无关的敏感 / 外部资源。
4. 学生输入中未涉及的代码工程操作。

# 学生最近的输入（判断是否相关的依据）
<student_input>
${lastUserText || "（暂无）"}
</student_input>

# 输出要求
只输出一个严格 JSON 对象，不要输出任何其他文字：
{"approved": true 或 false, "reason": "一句话中文原因"}
判断要严格：拿不准时一律 approved=false。`
}


export class EduGuardrailReviewer {
	private readonly deps: EduGuardrailReviewerDeps

	constructor(deps: EduGuardrailReviewerDeps) {
		this.deps = deps
	}

	/**
	 * 审核一次工具操作。
	 * 快速通道命中 → approved；否则 LLM 审核；失败 → rejected。
	 */
	async review(toolName: ClineDefaultTool, path?: string, detail?: EduGuardrailDetail): Promise<EduGuardrailDecision> {
		if (this.deps.taskState.abort) {
			// 任务正在被取消，交给执行器正常中止，不当作拒绝
			return { status: "manual" }
		}

		const targetPath = detail?.filePath || path

		// ① 快速通道：工作区内的只读操作（读资料 / 讲义 / 题目文件）
		if (READ_ONLY_TOOLS.includes(toolName) && targetPath && (await this.isWithinWorkspace(targetPath))) {
			return { status: "approved", reason: "工作区内只读操作（快速通道）" }
		}

		// ② 快速通道：学习数据目录（.cline-chinese-edu/）内的写入（学习进度 / 错题记录维护）
		if (WRITE_TOOLS.includes(toolName) && targetPath && (await this.isWithinEduDir(targetPath))) {
			return { status: "approved", reason: "学习数据目录内写入（快速通道）" }
		}

		// ③ 其余操作走 LLM 审核（写文件 / 命令 / 网络 / 浏览器 / MCP）
		const lastUserText = this.extractLastUserText()
		const systemPrompt = buildReviewerSystemPrompt(lastUserText)
		const userPrompt = `待审核操作：
工具：${toolName}
${describeOperation(toolName, path, detail)}

请输出 JSON 审核结论。`

		let text = ""
		try {
			const messages: ClineStorageMessage[] = [{ role: "user", content: userPrompt }]
			const stream = this.deps.api.createMessage(systemPrompt, messages)
			for await (const chunk of stream) {
				if (this.deps.taskState.abort) {
					return { status: "manual" }
				}
				if (chunk.type === "text") {
					text += chunk.text
				}
			}
		} catch {
			// 失败兜底：无法完成审核 → 安全起见拒绝执行
			return { status: "rejected", reason: "教育防护子 Agent 审核调用失败，出于安全未批准该操作。请改做与教学直接相关的操作。" }
		}

		const parsed = parseReviewerJson(text)
		if (!parsed) {
			return { status: "rejected", reason: "教育防护子 Agent 未返回有效结论，出于安全未批准该操作。请改做与教学直接相关的操作。" }
		}
		if (parsed.approved) {
			return { status: "approved", reason: parsed.reason || "与学习任务相关" }
		}
		return { status: "rejected", reason: parsed.reason || "该操作与当前学习任务无关" }
	}

	/** 路径是否位于当前工作区内 */
	private async isWithinWorkspace(p: string): Promise<boolean> {
		const norm = await this.normalize(p)
		const cwd = pathResolveLower(this.deps.cwd)
		return norm.startsWith(cwd)
	}

	/** 路径是否位于学习数据目录 `.cline-chinese-edu/` 内 */
	private async isWithinEduDir(p: string): Promise<boolean> {
		const norm = await this.normalize(p)
		const eduDir = pathResolveLower(getEduDirPath(this.deps.cwd))
		return norm.startsWith(eduDir)
	}

	private async normalize(p: string): Promise<string> {
		// handler 传入的多为工作区相对路径；也兼容绝对路径
		const absolute = nodePath.isAbsolute(p) ? p : nodePath.join(this.deps.cwd, p)
		return pathResolveLower(absolute)
	}

	/** 从任务最近一次用户输入中提取纯文本（作为「学生最近在做什么」的判断依据） */
	private extractLastUserText(): string {
		const blocks = this.deps.taskState.userMessageContent
		const text = blocks
			.map((b) => ("text" in b && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : ""))
			.join(" ")
			.trim()
		// 取末尾，避免提示词过长
		return text.slice(-4000)
	}
}

/** 从模型输出中提取首个可解析的 JSON 审核结论 */
function parseReviewerJson(text: string): { approved: boolean; reason?: string } | undefined {
	const trimmed = text.trim()
	const start = trimmed.indexOf("{")
	const end = trimmed.lastIndexOf("}")
	if (start === -1 || end === -1 || end <= start) {
		return undefined
	}
	try {
		const obj: unknown = JSON.parse(trimmed.slice(start, end + 1))
		if (obj && typeof obj === "object" && "approved" in obj) {
			const reason = (obj as { reason?: unknown }).reason
			return { approved: Boolean((obj as { approved: unknown }).approved), reason: typeof reason === "string" ? reason : undefined }
		}
		return undefined
	} catch {
		return undefined
	}
}

function pathResolveLower(p: string): string {
	return nodePath.resolve(p).toLowerCase()
}

export { EDU_DIR_NAME as EDUCATION_DATA_DIR }
