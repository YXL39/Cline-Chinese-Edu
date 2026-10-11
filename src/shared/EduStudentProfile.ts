/**
 * Cline Chinese Edu 学生信息档案（纯数据定义，共享给扩展宿主与 Webview）。
 * 该对象保存在工作区隐藏目录 `.cline-chinese-edu/profile.json` 中。
 */

/** 教材版本标识 */
export type EduVersionKey = "people" | "bj" | "su" | "zj" | "custom"

export interface EduSubjectInfo {
	/** 学科名，例如「数学」 */
	subject: string
	/** 教材版本：people=人教版, bj=北师大版, su=苏教版, zj=浙教版, custom=自定义 */
	version: EduVersionKey | string
	/** version === "custom" 时的自定义教材名 */
	customVersion?: string
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
