import * as fs from "node:fs/promises"
import * as path from "node:path"
import { EDU_VERSION_LABELS, type EduStudentProfile, type EduSubjectInfo } from "@shared/EduStudentProfile"

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
	// 浙教版的「道德与法治」在课标中显示为「综合社会」
	const base = s.version === "zj" && s.subject === "道德与法治" ? "综合社会" : s.subject
	if (s.version === "custom") {
		return s.customVersion ? `${base}（自定义：${s.customVersion}）` : base
	}
	const versionLabel = EDU_VERSION_LABELS[s.version]
	return versionLabel ? `${base}（${versionLabel}）` : base
}

/**
 * 写入学生档案，并自动初始化 progress.json / mistake.json（不覆盖已有内容），
 * 同时把 `.cline-chinese-edu/` 追加到工作区 .gitignore。
 */
export async function writeEduProfile(cwd: string, profile: EduStudentProfile): Promise<void> {
	const dir = getEduDirPath(cwd)
	await ensureDir(dir)

	const fullProfile: EduStudentProfile = { ...profile, completedAt: Date.now() }
	await fs.writeFile(path.join(dir, PROFILE_FILE), JSON.stringify(fullProfile, null, 2), "utf-8")

	const progressInitial = {
		updatedAt: new Date().toISOString(),
		subjects: profile.subjects.map((s) => ({
			subject: subjectLabel(s),
			completedTopics: [] as string[],
		})),
	}
	const mistakeInitial = {
		updatedAt: new Date().toISOString(),
		entries: [] as Array<{ subject: string; topic: string; summary: string; date: string; resolved?: boolean }>,
	}
	await ensureJsonFile(path.join(dir, PROGRESS_FILE), progressInitial)
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

/**
 * 构建注入到系统提示词的学习上下文（学生档案 + 进度 + 错题 + 自动维护规则）。
 * 没有档案时返回 undefined。
 */
export async function buildStudyContextInstructions(cwd?: string): Promise<string | undefined> {
	const profile = await readEduProfile(cwd)
	if (!profile || !cwd) {
		return undefined
	}
	const dir = getEduDirPath(cwd)
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

	const termLabel = profile.term === 2 ? "下学期" : "上学期"
	const lines: string[] = [
		"# 学生学习上下文（Cline Chinese Edu）",
		``,
		`- 学生：${profile.grade} 年级（${termLabel}）`,
		`- 科目：${profile.subjects.map(subjectLabel).join("、") || "未设置"}`,
		``,
		`## 学习进度（工作区文件 ${EDU_DIR_NAME}/${PROGRESS_FILE}）`,
		progressJson ? progressJson.slice(0, MAX_JSON_IN_PROMPT) : "（暂无数据）",
		``,
		`## 常见错题（工作区文件 ${EDU_DIR_NAME}/${MISTAKE_FILE}）`,
		mistakeJson ? mistakeJson.slice(0, MAX_JSON_IN_PROMPT) : "（暂无数据）",
		``,
		`## 回答方式要求`,
		`学习进度与错题记录仅供你内部参考，用于调整讲解难度与措辞。不要向学生复述、引用或展示这些学习数据，严禁说出"根据学习进度记录，你是小学一年级（上学期）学生"之类的话。`,
		``,
		`## 学习数据自动维护要求`,
		`与这位学生交流时，你需要自动维护工作区根目录 ${EDU_DIR_NAME}/ 下的学习数据文件：`,
		`1. 学生解题出错或暴露知识薄弱点时，向 mistake.json 的 entries 追加一条记录（含 subject、topic、summary、date 字段），并更新 updatedAt。`,
		`2. 学生明显掌握某个知识点或完成某章节/某类练习时，将该内容名写入 progress.json 中对应科目的 completedTopics，并更新 updatedAt。`,
		`3. 更新前必须先读取文件现有内容，采用合并方式保留历史记录，不要覆盖或删除已有条目。`,
		`4. 不确定某条记录是否成立时，先向学生确认。`,
	]
	return lines.join("\n")
}
