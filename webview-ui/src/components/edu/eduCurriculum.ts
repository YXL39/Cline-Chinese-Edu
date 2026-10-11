import type { EduSubjectInfo } from "@shared/EduStudentProfile"

/** 教材版本选项（所有科目共用同一套下拉） */
export const EDITION_OPTIONS: Array<{ key: string; label: string }> = [
	{ key: "people", label: "人教版" },
	{ key: "bj", label: "北师大版" },
	{ key: "su", label: "苏教版" },
	{ key: "zj", label: "浙教版" },
	{ key: "custom", label: "自定义" },
]

export const GRADES: number[] = Array.from({ length: 12 }, (_, i) => i + 1)

const CN_NUM = ["一", "二", "三", "四", "五", "六"]

export function gradeLabel(grade: number): string {
	if (grade <= 6) {
		return `小学${CN_NUM[grade - 1]}年级`
	}
	if (grade <= 9) {
		return `初中${CN_NUM[grade - 7]}年级`
	}
	return `高中${CN_NUM[grade - 10]}年级`
}

/** 科目清单按年级动态生成 */
export function subjectsForGrade(grade: number): string[] {
	if (grade <= 2) {
		return ["语文", "数学", "道德与法治"]
	}
	if (grade <= 6) {
		return ["语文", "数学", "英语", "科学", "道德与法治"]
	}
	if (grade === 7) {
		return ["语文", "数学", "英语", "历史", "地理", "道德与法治"]
	}
	if (grade === 8) {
		return ["语文", "数学", "英语", "物理", "历史", "地理", "道德与法治"]
	}
	if (grade === 9) {
		return ["语文", "数学", "英语", "物理", "化学", "历史", "道德与法治"]
	}
	return ["语文", "数学", "英语", "物理", "化学", "生物学", "历史", "地理", "政治"]
}

export function buildSubjectsForGrade(grade: number, version = "people"): EduSubjectInfo[] {
	return subjectsForGrade(grade).map((subject) => ({ subject, version }))
}

/** 浙教版的「道德与法治」显示为「综合社会」 */
export function displaySubjectName(subject: string, version: string): string {
	return version === "zj" && subject === "道德与法治" ? "综合社会" : subject
}

export function editionLabel(key: string): string {
	return EDITION_OPTIONS.find((o) => o.key === key)?.label ?? key
}
