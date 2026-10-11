import { strict as assert } from "node:assert"
import * as fs from "node:fs"
import * as nodePath from "node:path"
import { describe, it } from "mocha"
import { ClineDefaultTool } from "@shared/tools"
import type { ApiHandler } from "@/core/api"
import type { StateManager } from "@/core/storage/StateManager"
import { TaskState } from "@/core/task/TaskState"
import { EduGuardrailDecision, EduGuardrailReviewer } from "../reviewer"

/** 构造最小可用的审核器（cwd 用当前目录下临时子目录，跨平台安全） */
function makeReviewer(
	opts: {
		cwd?: string
		/** 模拟 LLM 输出的文本；传 Error 则 createMessage 抛错 */
		llmOutput?: string | Error
		taskState?: TaskState
		onLlmCall?: () => void
	} = {},
): { reviewer: EduGuardrailReviewer; taskState: TaskState; llmCalls: { count: number } } {
	const cwd = opts.cwd ?? nodePath.join(process.cwd(), "edu-reviewer-test-ws")
	fs.mkdirSync(cwd, { recursive: true })

	const taskState = opts.taskState ?? new TaskState()
	taskState.userMessageContent = [{ type: "text", text: "老师，这道二次方程题怎么做？" }] as TaskState["userMessageContent"]

	const stateManager = { getGlobalSettingsKey: (_key: string) => true } as unknown as StateManager

	const llmCalls = { count: 0 }
	const api = {
		createMessage: (_systemPrompt: string, _messages: unknown[]) => {
			llmCalls.count += 1
			opts.onLlmCall?.()
			const gen = async function* () {
				if (typeof opts.llmOutput === "string") {
					yield { type: "text", text: opts.llmOutput }
				} else if (opts.llmOutput instanceof Error) {
					throw opts.llmOutput
				}
			}
			return gen() as unknown as ReturnType<ApiHandler["createMessage"]>
		},
		getModel: () => ({ id: "test-model", info: { supportsPromptCache: false } }),
	} as unknown as ApiHandler

	return { reviewer: new EduGuardrailReviewer({ stateManager, api, taskState, cwd }), taskState, llmCalls }
}

describe("EduGuardrailReviewer（教育防护子 Agent）", () => {
	it("工作区内只读操作走快速通道直接批准，且不调用 LLM", async () => {
		const { reviewer, llmCalls } = makeReviewer()
		const decision: EduGuardrailDecision = await reviewer.review(ClineDefaultTool.FILE_READ, "materials/讲义.md")
		assert.equal(decision.status, "approved")
		assert.equal(llmCalls.count, 0)
	})

	it(".cline-chinese-edu/ 学习数据目录内写入走快速通道直接批准", async () => {
		const { reviewer, llmCalls } = makeReviewer()
		const decision = await reviewer.review(ClineDefaultTool.FILE_NEW, ".cline-chinese-edu/progress.json")
		assert.equal(decision.status, "approved")
		assert.equal(llmCalls.count, 0)
	})

	it("工作区外操作不走快速通道，交给 LLM 审核", async () => {
		const { reviewer, llmCalls } = makeReviewer({ llmOutput: '{"approved": false, "reason": "外部文件与学习无关"}' })
		const decision = await reviewer.review(ClineDefaultTool.FILE_READ, "../../other-repo/src/main.ts")
		assert.equal(decision.status, "rejected")
		assert.equal(llmCalls.count, 1)
	})

	it("LLM 判定与学习相关时批准（写作业文件）", async () => {
		const { reviewer } = makeReviewer({ llmOutput: '{"approved": true, "reason": "为学生生成练习卷"}' })
		const decision = await reviewer.review(ClineDefaultTool.FILE_NEW, "作业/练习卷.md", { filePath: "作业/练习卷.md" })
		assert.equal(decision.status, "approved")
	})

	it("LLM 判定无关时拒绝（执行命令）", async () => {
		const { reviewer } = makeReviewer({ llmOutput: '{"approved": false, "reason": "安装依赖与学习任务无关"}' })
		const decision = await reviewer.review(ClineDefaultTool.BASH, undefined, { command: "npm install" })
		assert.equal(decision.status, "rejected")
		assert.match((decision as { reason: string }).reason, /安装依赖/)
	})

	it("LLM 调用失败时安全兜底：拒绝执行", async () => {
		const { reviewer } = makeReviewer({ llmOutput: new Error("network down") })
		const decision = await reviewer.review(ClineDefaultTool.BASH, undefined, { command: "echo 1" })
		assert.equal(decision.status, "rejected")
	})

	it("LLM 输出无法解析为 JSON 时安全兜底：拒绝执行", async () => {
		const { reviewer } = makeReviewer({ llmOutput: "我觉得这个操作不太好，抱歉" })
		const decision = await reviewer.review(ClineDefaultTool.WEB_FETCH, undefined, { url: "https://example.com" })
		assert.equal(decision.status, "rejected")
	})

	it("任务被取消时返回 manual（交由执行器正常中止，不当作拒绝）", async () => {
		const { reviewer, taskState } = makeReviewer()
		taskState.abort = true
		const decision = await reviewer.review(ClineDefaultTool.BASH, undefined, { command: "echo 1" })
		assert.equal(decision.status, "manual")
	})
})
