import { strict as assert } from "node:assert"
import * as fs from "node:fs"
import * as nodePath from "node:path"
import { describe, it } from "mocha"
import { EduStudentProfile } from "@shared/EduStudentProfile"
import {
	advanceEduSchoolProgressData,
	buildStudyContextInstructions,
	normalizeEduProgress,
	readEduProfile,
	readEduProgress,
	writeEduProfile,
} from "../eduDataFiles"

/** 构造临时工作区，跨平台安全 */
function makeWorkspace(name: string): string {
	const cwd = nodePath.join(process.cwd(), name)
	fs.rmSync(cwd, { recursive: true, force: true })
	fs.mkdirSync(cwd, { recursive: true })
	return cwd
}

const profile = (overrides?: Partial<EduStudentProfile>): EduStudentProfile => ({
	grade: 7,
	term: 1,
	subjects: [
		{ subject: "数学", version: "people" },
		{ subject: "英语", version: "su" },
	],
	...overrides,
})

describe("eduDataFiles（Cline Chinese Edu v2 数据层）", () => {
	it("v1 progress.json（completedTopics 扁平结构）自动迁移为 v2（ahead.completed）", () => {
		const v1 = {
			updatedAt: "2025-01-01T00:00:00.000Z",
			subjects: [
				{ subject: "数学（人教版）", completedTopics: ["第一章", "第二章"] },
				{ subject: "英语（苏教版）", completedTopics: [] },
			],
		}
		const normalized = normalizeEduProgress(v1)
		assert.ok(normalized)
		assert.equal(normalized.version, 2)
		assert.deepEqual(normalized.subjects[0].ahead.completed, ["第一章", "第二章"])
		assert.equal(normalized.subjects[0].ahead.current, "")
		assert.deepEqual(normalized.subjects[0].review, [])
		assert.deepEqual(normalized.subjects[0].examReview, { enabled: false, target: undefined })
	})

	it("writeEduProfile 初始化 progress.json v2 条目，并按学科合并保留学校进度", async () => {
		const cwd = makeWorkspace("edu-v2-write-ws")
		await writeEduProfile(cwd, profile())

		// progress.json：每个学科一个 v2 条目
		const progress = await readEduProgress(cwd)
		assert.ok(progress)
		assert.equal(progress.subjects.length, 2)
		assert.ok(progress.subjects.some((s) => s.subject === "数学（人教版）"))
		assert.ok(progress.subjects.every((s) => s.examReview && s.examReview.enabled === false))

		// 推进一次学校进度
		await advanceEduSchoolProgressData(cwd, "数学", "people", "七年级上册·第三章")
		const withProgress = await readEduProfile(cwd)
		assert.equal(withProgress?.subjects[0].schoolProgress?.current, "七年级上册·第三章")

		// 重存档案（不带 schoolProgress）不应丢失学校进度
		await writeEduProfile(cwd, profile())
		const reloaded = await readEduProfile(cwd)
		assert.equal(reloaded?.subjects[0].schoolProgress?.current, "七年级上册·第三章")
	})

	it("推进学校进度：旧当前归档到 completedUnits（去重），对应单元入复习区", async () => {
		const cwd = makeWorkspace("edu-v2-advance-ws")
		await writeEduProfile(cwd, profile())

		await advanceEduSchoolProgressData(cwd, "数学", "people", "七年级上册·第三章")
		let math = (await readEduProfile(cwd))!.subjects[0]
		assert.equal(math.schoolProgress?.current, "七年级上册·第三章")
		// 第一次推进没有旧当前，completedUnits 应为空
		assert.deepEqual(math.schoolProgress?.completedUnits, [])

		await advanceEduSchoolProgressData(cwd, "数学", "people", "七年级上册·第四章")
		math = (await readEduProfile(cwd))!.subjects[0]
		assert.equal(math.schoolProgress?.current, "七年级上册·第四章")
		assert.deepEqual(math.schoolProgress?.completedUnits, ["七年级上册·第三章"])

		// 复习区：旧的当前（第三章）以 scope=unit pending 入队
		const progress = await readEduProgress(cwd)
		const mathProgress = progress!.subjects.find((s) => s.subject === "数学（人教版）")
		assert.ok(mathProgress)
		const unitReviews = mathProgress.review.filter((r) => r.scope === "unit")
		assert.deepEqual(unitReviews.map((r) => r.topic), ["七年级上册·第三章"])
		assert.equal(unitReviews[0].status, "pending")

		// 再次推进（第四章 → 第五章）：pending 已存在则不重复入队
		await advanceEduSchoolProgressData(cwd, "数学", "people", "七年级上册·第五章")
		const progress2 = await readEduProgress(cwd)
		const mathProgress2 = progress2!.subjects.find((s) => s.subject === "数学（人教版）")
		const unitReviews2 = mathProgress2!.review.filter((r) => r.scope === "unit")
		assert.deepEqual(unitReviews2.map((r) => r.topic), ["七年级上册·第三章", "七年级上册·第四章"])

		// 无档案时推进应报错
		await assert.rejects(advanceEduSchoolProgressData(makeWorkspace("edu-v2-no-profile-ws"), "数学", "people", "x"))
	})

	it("buildStudyContextInstructions：主聊天含学校进度 / 超前学 / 复习规则；子聊天为受限常识指令", async () => {
		const cwd = makeWorkspace("edu-v2-prompt-ws")
		await writeEduProfile(cwd, profile())
		await advanceEduSchoolProgressData(cwd, "数学", "people", "七年级上册·第三章")

		const main = await buildStudyContextInstructions(cwd, "main")
		assert.ok(main)
		assert.ok(main.includes("学校当前讲到「七年级上册·第三章」"))
		assert.ok(main.includes("ahead / review / examReview"))
		assert.ok(main.includes("scope=unit"))
		assert.ok(main.includes("examReview（大考超级复习）为占位能力"))
		// 证据充分时允许 AI 修正学校进度（走自动批准）
		assert.ok(main.includes("直接编辑"))

		const sub = await buildStudyContextInstructions(cwd, "sub")
		assert.ok(sub)
		assert.ok(sub.includes("子聊天模式"))
		assert.ok(sub.includes("300 字"))
		assert.ok(sub.includes("不使用文件写入与命令执行类工具"))
		assert.ok(!sub.includes("学习数据自动维护要求"))
	})

	it("无档案时 buildStudyContextInstructions 返回 undefined", async () => {
		const cwd = makeWorkspace("edu-v2-empty-ws")
		assert.equal(await buildStudyContextInstructions(cwd, "main"), undefined)
		assert.equal(await buildStudyContextInstructions(cwd, "sub"), undefined)
	})
})