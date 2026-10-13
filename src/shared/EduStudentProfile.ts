/**
 * Cline Chinese Edu 学生信息档案（纯数据定义，共享给扩展宿主与 Webview）。
 * 该对象保存在工作区隐藏目录 `.cline-chinese-edu/profile.json` 中。
 */

/** 教材版本标识 */
export type EduVersionKey = "people" | "bj" | "su" | "zj" | "custom"

/** Cline Chinese Edu v2: 学校进度（由学生通过聊天页「推进」按钮维护，AI 只读） */
export interface EduSchoolProgress {
	/** 学校当前讲到哪里（如「七年级上册·第三章 整式的乘法与因式分解」） */
	current: string
	/** 本学期已学单元（推进时归档的旧当前单元） */
	completedUnits: string[]
}

export interface EduSubjectInfo {
	/** 学科名，例如「数学」 */
	subject: string
	/** 教材版本：people=人教版, bj=北师大版, su=苏教版, zj=浙教版, custom=自定义 */
	version: EduVersionKey | string
	/** version === "custom" 时的自定义教材名 */
	customVersion?: string
	/** v2: 学校进度（保存在 profile.json，AI 默认只读） */
	schoolProgress?: EduSchoolProgress
}

export interface EduStudentProfile {
	/** 年级 1-12 */
	grade: number
	/** 学期：1=上学期，2=下学期 */
	term: number
	/** 学科与教材版本列表（由向导根据年级动态生成） */
	subjects: EduSubjectInfo[]
	/** 档案完成时间（毫秒时间戳，扩展端写入） */
	completedAt?: number
}

export const EDU_VERSION_LABELS: Record<string, string> = {
	people: "人教版",
	bj: "北师大版",
	su: "苏教版",
	zj: "浙教版",
	custom: "自定义",
}

/**
 * 学科展示标签，如「数学（人教版）」；progress.json 条目与提示词均使用它。
 * 宿主端 eduDataFiles 与 webview 卡片共用，保证标签一致。
 */
export function eduSubjectLabel(s: { subject: string; version: EduVersionKey | string; customVersion?: string }): string {
	// 浙教版的「道德与法治」在课标中显示为「综合社会」
	const base = s.version === "zj" && s.subject === "道德与法治" ? "综合社会" : s.subject
	if (s.version === "custom") {
		return s.customVersion ? `${base}（自定义：${s.customVersion}）` : base
	}
	const versionLabel = EDU_VERSION_LABELS[s.version]
	return versionLabel ? `${base}（${versionLabel}）` : base
}

/*
 * Cline Chinese Edu v2 学习进度（progress.json，AI 维护，保存在 .cline-chinese-edu/progress.json）：
 * - ahead: 超前学进度（学校进度之后的内容）
 * - review: 复习区，覆盖本学期已学内容（scope=unit）与错题（scope=mistake）
 * - examReview: 大考超级复习（期末/毕业），当前为占位，暂未启用
 */

/** 超前学进度 */
export interface EduAheadProgress {
	/** 超前学当前讲到哪里 */
	current: string
	/** 已完成的超前学内容 */
	completed: string[]
	updatedAt?: string
}

/** 复习条目 */
export interface EduReviewEntry {
	/** 复习主题（单元名或错题摘要） */
	topic: string
	/** unit=本学期已学单元 / mistake=错题 / exam=大考总复习（占位） */
	scope: "unit" | "mistake" | "exam"
	status: "pending" | "done"
	updatedAt?: string
}

/** 大考超级复习（占位：期末大考 / 毕业大考，暂未启用） */
export interface EduExamReview {
	enabled: boolean
	target?: "final" | "graduation"
}

/** 单学科学习进度 */
export interface EduSubjectProgress {
	/** 学科标签，如「数学（人教版）」 */
	subject: string
	ahead: EduAheadProgress
	review: EduReviewEntry[]
	examReview?: EduExamReview
}

/** progress.json 文件结构（v2） */
export interface EduProgressFile {
	version: 2
	updatedAt: string
	subjects: EduSubjectProgress[]
}
