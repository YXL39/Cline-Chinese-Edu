import * as fs from "node:fs/promises"
import * as path from "node:path"
import {
	type EduProgressFile,
	type EduReviewEntry,
	type EduStudentProfile,
	type EduSubjectInfo,
	type EduSubjectProgress,
	eduSubjectLabel,
} from "@shared/EduStudentProfile"

/** 工作区内的隐藏数据目录名 */
export const EDU_DIR_NAME = ".cline-chinese-edu"

const PROFILE_FILE = "profile.json"
const PROGRESS_FILE = "progress.json"
const MISTAKE_FILE = "mistake.json"

export function getEduDirPath(cwd: string): string {
	return path.join(cwd, EDU_DIR_NAME)
}

async function ensureDir(dirPath: string): Promise<void> {
	await fs.mkdir(dirPath, { recursive: true })
}

function isValidProfile(value: unknown): value is EduStudentProfile {
	if (!value || typeof value !== "object") {
		return false
	}
	const p = value as EduStudentProfile
	return typeof p.grade === "number" && p.grade >= 1 && p.grade <= 12 && Array.isArray(p.subjects)
}

/** 读取工作区 `.cline-chinese-edu/profile.json`；不存在或非法时返回 undefined */
export async function readEduProfile(cwd?: string): Promise<EduStudentProfile | undefined> {
	if (!cwd) {
		return undefined
	}
	try {
		const content = await fs.readFile(path.join(getEduDirPath(cwd), PROFILE_FILE), "utf-8")
		const parsed: unknown = JSON.parse(content)
		return isValidProfile(parsed) ? parsed : undefined
	} catch {
		return undefined
	}
}

function subjectLabel(s: EduSubjectInfo): string {
	// 与共享 eduSubjectLabel 保持一致（含浙教版「道德与法治」→「综合社会」特例）
	return eduSubjectLabel(s)
}

/**
 * 写入学生档案（profile.json，含 schoolProgress 学校进度），并自动初始化 / 同步
 * progress.json（v2：ahead 超前学 / review 复习区 / examReview 大考占位）与 mistake.json，
 * 同时把 `.cline-chinese-edu/` 追加到工作区 .gitignore。
 * - 旧档案里的学校进度（schoolProgress）按学科合并保留，避免重存档案时丢失；
 * - 旧版 progress.json（completedTopics 扁平结构）自动迁移到 v2 结构。
 */
export async function writeEduProfile(cwd: string, profile: EduStudentProfile): Promise<void> {
	const dir = getEduDirPath(cwd)
	await ensureDir(dir)

	// 合并旧档案里的学校进度（按 学科+版本 匹配）
	const old = await readEduProfile(cwd)
	const oldBySub = new Map((old?.subjects ?? []).map((s) => [`${s.subject}#${s.version}`, s]))
	const fullProfile: EduStudentProfile = {
		...profile,
		completedAt: Date.now(),
		subjects: profile.subjects.map((s) => ({
			...s,
			schoolProgress: s.schoolProgress ?? oldBySub.get(`${s.subject}#${s.version}`)?.schoolProgress,
		})),
	}
	await fs.writeFile(path.join(dir, PROFILE_FILE), JSON.stringify(fullProfile, null, 2), "utf-8")

	// 初始化 / 同步 progress.json（v2）
	const progress =
		(await readEduProgress(cwd)) ?? {
			version: 2,
			updatedAt: new Date().toISOString(),
			subjects: [],
		}
	const seen = new Set(progress.subjects.map((s) => s.subject))
	for (const s of fullProfile.subjects) {
		const label = subjectLabel(s)
		if (!seen.has(label)) {
			progress.subjects.push({
				subject: label,
				ahead: { current: "", completed: [] },
				review: [],
				examReview: { enabled: false, target: undefined },
			})
		}
	}
	progress.updatedAt = new Date().toISOString()
	await fs.writeFile(path.join(dir, PROGRESS_FILE), JSON.stringify(progress, null, 2), "utf-8")

	// mistake.json 仅缺失时初始化
	const mistakeInitial = {
		updatedAt: new Date().toISOString(),
		entries: [] as Array<{ subject: string; topic: string; summary: string; date: string; resolved?: boolean }>,
	}
	await ensureJsonFile(path.join(dir, MISTAKE_FILE), mistakeInitial)
	await ensureGitignoreEntry(cwd)
}

async function ensureJsonFile(filePath: string, initial: unknown): Promise<void> {
	try {
		await fs.access(filePath)
	} catch {
		await fs.writeFile(filePath, JSON.stringify(initial, null, 2), "utf-8")
	}
}

async function ensureGitignoreEntry(cwd: string): Promise<void> {
	const gitignorePath = path.join(cwd, ".gitignore")
	let content = ""
	try {
		content = await fs.readFile(gitignorePath, "utf-8")
	} catch {
		content = ""
	}
	const lines = content.split(/\r?\n/)
	const alreadyPresent = lines.some((l) => l.trim() === `${EDU_DIR_NAME}/`)
	if (alreadyPresent) {
		return
	}
	const entry = `# Cline Chinese Edu 学习数据目录\n${EDU_DIR_NAME}/\n`
	const base = content ? content.replace(/\s+$/, "") + "\n" : ""
	await fs.writeFile(gitignorePath, base + entry, "utf-8")
}

const MAX_JSON_IN_PROMPT = 4000

function dedupe(values: string[]): string[] {
	return [...new Set(values)]
}

/** 规范化单学科进度条目（v1 completedTopics → v2 ahead/review/examReview） */
function normalizeSubject(raw: any): EduSubjectProgress | undefined {
	if (!raw || typeof raw.subject !== "string") {
		return undefined
	}
	const legacy: string[] = Array.isArray(raw.completedTopics)
		? raw.completedTopics.filter((x: unknown) => typeof x === "string")
		: []
	return {
		subject: raw.subject,
		ahead: {
			current: typeof raw.ahead?.current === "string" ? raw.ahead.current : "",
			completed: Array.isArray(raw.ahead?.completed)
				? raw.ahead.completed.filter((x: unknown) => typeof x === "string")
				: legacy,
			updatedAt: typeof raw.ahead?.updatedAt === "string" ? raw.ahead.updatedAt : undefined,
		},
		review: Array.isArray(raw.review)
			? raw.review
					.filter((r: any) => r && typeof r.topic === "string")
					.map((r: any): EduReviewEntry => ({
						topic: r.topic,
						scope: r.scope === "mistake" ? "mistake" : r.scope === "exam" ? "exam" : "unit",
						status: r.status === "done" ? "done" : "pending",
						updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : undefined,
					}))
			: [],
		examReview: { enabled: false, target: undefined },
	}
}

/** 规范化整个 progress.json（v1 → v2 结构） */
export function normalizeEduProgress(raw: unknown): EduProgressFile | undefined {
	if (!raw || typeof raw !== "object") {
		return undefined
	}
	const subjectList: unknown[] = Array.isArray((raw as any).subjects) ? (raw as any).subjects : []
	const subjects = subjectList
		.map(normalizeSubject)
		.filter((s): s is EduSubjectProgress => !!s)
	return {
		version: 2,
		updatedAt: typeof (raw as any).updatedAt === "string" ? (raw as any).updatedAt : new Date().toISOString(),
		subjects,
	}
}

/**
 * 读取学习进度（progress.json；v1 结构自动迁移为 v2，不落盘）。
 * 文件不存在 / 非法时返回 undefined。
 */
export async function readEduProgress(cwd?: string): Promise<EduProgressFile | undefined> {
	if (!cwd) {
		return undefined
	}
	try {
		const content = await fs.readFile(path.join(getEduDirPath(cwd), PROGRESS_FILE), "utf-8")
		return normalizeEduProgress(JSON.parse(content))
	} catch {
		return undefined
	}
}

/**
 * 推进某学科的学校进度（聊天页「推进」按钮调用）：
 * 1) profile.json：旧「当前」归档到 completedUnits（去重），current 更新为新的位置；
 * 2) progress.json：复习区追加对应 unit 条目（pending；已存在未完成则刷新时间，已完成则不动）。
 * 无档案 / 找不到学科时抛出，便于 webview 显示原因。
 */
export async function advanceEduSchoolProgressData(
	cwd: string,
	subject: string,
	version: string | undefined,
	newCurrent: string,
): Promise<void> {
	const dir = getEduDirPath(cwd)

	// 1) profile.json
	const profile = await readEduProfile(cwd)
	if (!profile) {
		throw new Error(`未找到学生档案（${dir}/${PROFILE_FILE}），无法推进学校进度`)
	}
	const target = profile.subjects.find((s) => s.subject === subject && (!version || s.version === version))
	if (!target) {
		throw new Error(`学生档案里找不到学科「${subject}」`)
	}
	const old = target.schoolProgress?.current?.trim() ?? ""
	target.schoolProgress = {
		current: newCurrent,
		completedUnits: dedupe([...(target.schoolProgress?.completedUnits ?? []), ...(old ? [old] : [])]),
	}
	await fs.writeFile(path.join(dir, PROFILE_FILE), JSON.stringify(profile, null, 2), "utf-8")

	// 2) progress.json 复习区
	const progress =
		(await readEduProgress(cwd)) ?? {
			version: 2,
			updatedAt: new Date().toISOString(),
			subjects: [],
		}
	const label = subjectLabel(target)
	let sp = progress.subjects.find((s) => s.subject === label)
	if (!sp) {
		sp = {
			subject: label,
			ahead: { current: "", completed: [] },
			review: [],
			examReview: { enabled: false, target: undefined },
		}
		progress.subjects.push(sp)
	}
	const nowIso = new Date().toISOString()
	if (old) {
		const existing = sp.review.find((r) => r.scope === "unit" && r.topic === old)
		if (existing && existing.status !== "done") {
			existing.updatedAt = nowIso
		} else {
			sp.review.push({ topic: old, scope: "unit", status: "pending", updatedAt: nowIso })
		}
	}
	progress.updatedAt = nowIso
	await fs.writeFile(path.join(dir, PROGRESS_FILE), JSON.stringify(progress, null, 2), "utf-8")
}

/**
 * 构建注入到系统提示词的学习上下文（学生档案 + 学校进度 + 进度 + 错题 + 自动维护规则）。
 * - variant === "sub"：子聊天（常识速问）受限指令，只答常识快问、禁止维护学习数据；
 * - 缺省（主聊天）：完整学习上下文与维护规则。
 * 没有档案时返回 undefined。
 */
export async function buildStudyContextInstructions(cwd?: string, variant?: "main" | "sub"): Promise<string | undefined> {
	const profile = await readEduProfile(cwd)
	if (!profile || !cwd) {
		return undefined
	}
	const dir = getEduDirPath(cwd)
	const termLabel = profile.term === 2 ? "下学期" : "上学期"

	if (variant === "sub") {
		const subjects = profile.subjects.map(subjectLabel).join("、")
		return [
			"# 子聊天模式：常识速问（Cline Chinese Edu）",
			"",
			`你是子聊天助手，学生背景：${profile.grade} 年级（${termLabel}），学习科目：${subjects}。`,
			"",
			"# 范围",
			"只回答文化常识、人文常识、学科常识类的快速问答（如历史事件、文化背景、常识性概念），单次回答尽量控制在 300 字以内。",
			"",
			"# 禁止",
			"- 不做系统长讲解、不出练习题、不批改作业、不组织复习；",
			`- 不读写、不维护任何学习数据文件（${EDU_DIR_NAME}/ 下的 profile.json、progress.json、mistake.json）；`,
			"- 不使用文件写入与命令执行类工具；确需查证时只能使用 web_search / web_fetch。",
			"",
			"# 越界处理",
			'当学生提出上述范围外的需求时，简短作答后说明："这个问题更适合在主聊天里深入，主聊天更适合系统讲解、练习和复习。"',
		].join("\n")
	}

	let progressJson = ""
	let mistakeJson = ""
	try {
		progressJson = await fs.readFile(path.join(dir, PROGRESS_FILE), "utf-8")
	} catch {
		/* ignore */
	}
	try {
		mistakeJson = await fs.readFile(path.join(dir, MISTAKE_FILE), "utf-8")
	} catch {
		/* ignore */
	}

	// 学校进度（profile.json 的 schoolProgress，学生通过聊天页「推进」按钮维护）
	const schoolLines = profile.subjects
		.map((s) => {
			const sp = s.schoolProgress
			if (!sp || !sp.current) {
				return `- ${subjectLabel(s)}：学校进度未设置（学生可在聊天页点「推进」维护）`
			}
			const units = sp.completedUnits?.length ? `；本学期已学单元：${sp.completedUnits.join("、")}` : ""
			return `- ${subjectLabel(s)}：学校当前讲到「${sp.current}」${units}`
		})
		.join("\n")

	const lines: string[] = [
		"# 学生学习上下文（Cline Chinese Edu）",
		"",
		`- 学生：${profile.grade} 年级（${termLabel}）`,
		`- 科目：${profile.subjects.map(subjectLabel).join("、") || "未设置"}`,
		"",
		`## 学校进度（${EDU_DIR_NAME}/${PROFILE_FILE} 的 schoolProgress，学生通过聊天页「推进」按钮维护）`,
		schoolLines,
		`- 学校进度默认只读。仅当学生明显推进错误且有充分证据（例如学生自述"老师还没讲到这里"、或在"已学单元"内容上反复表现出完全陌生）时，你可以直接编辑 ${EDU_DIR_NAME}/${PROFILE_FILE} 中对应学科的 schoolProgress 字段修正，并用一句话说明修正原因（该修改会由教育防护子 Agent 自动批准）。`,
		"",
		`## 超前学进度与复习区（${EDU_DIR_NAME}/${PROGRESS_FILE}，v2 结构：ahead / review / examReview）`,
		progressJson ? progressJson.slice(0, MAX_JSON_IN_PROMPT) : "（暂无数据）",
		"",
		`## 常见错题（${EDU_DIR_NAME}/${MISTAKE_FILE}）`,
		mistakeJson ? mistakeJson.slice(0, MAX_JSON_IN_PROMPT) : "（暂无数据）",
		"",
		"## 回答方式要求",
		"学习进度、错题记录仅供你内部参考，用于调整讲解难度与措辞。不要向学生复述、引用或展示这些学习数据，严禁说出\"根据学习进度记录，你是小学一年级（上学期）学生\"之类的话。",
		"",
		"## 学习数据自动维护要求",
		`与这位学生交流时，你需要自动维护工作区根目录 ${EDU_DIR_NAME}/ 下的学习数据文件：`,
		`1. 学生解题出错或暴露知识薄弱点时，向 mistake.json 的 entries 追加一条记录（含 subject、topic、summary、date 字段），并更新 updatedAt；同时在 progress.json 对应科目的 review 中追加 { topic: 错题摘要, scope: "mistake", status: "pending" }。`,
		`2. 超前学内容（学校进度之后的内容）讲解 / 练习完成后，把内容写入 progress.json 对应科目的 ahead.completed（去重），并更新 ahead.current；不要超前学学校尚未讲到的内容。`,
		`3. 复习提问覆盖 review 中 status=pending 的条目：scope=unit（本学期已学，学生推进学校进度时自动入队）与 scope=mistake（错题）；学生明显掌握后把对应条目标记 done。`,
		`4. examReview（大考超级复习）为占位能力，当前未启用；未经学生要求不要组织期末 / 毕业大考总复习。`,
		`5. 更新前必须先读取文件现有内容，采用合并方式保留历史记录，不要覆盖或删除已有条目。`,
		`6. 不确定某条记录是否成立时，先向学生确认。`,
	]
	return lines.join("\n")
}
