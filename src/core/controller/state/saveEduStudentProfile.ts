import { Empty } from "@shared/proto/cline/common"
import { EduStudentProfileRequest } from "@shared/proto/cline/state"
import { writeEduProfile } from "@/core/edu/eduDataFiles"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * 保存 Cline Chinese Edu 学生档案到工作区 `.cline-chinese-edu/` 目录，
 * 并刷新 webview 状态（向导完成后可进入聊天界面）。
 *
 * 保存失败时抛出错误（经 gRPC 传递回 webview 显示红色提示），
 * 避免 webview 在档案未实际落盘时误报「已保存」而卡在向导页。
 */
export async function saveEduStudentProfile(controller: Controller, request: EduStudentProfileRequest): Promise<Empty> {
	const profile = request.eduStudentProfile
	if (!profile) {
		throw new Error("学生档案数据为空，无法保存")
	}

	// 解析学习数据目录：优先工作区根目录，无根目录时回退到宿主当前目录
	const cwd = await controller.getEduDataCwd()
	if (!cwd) {
		throw new Error("未找到可用的工作区目录，无法保存学生档案")
	}
	Logger.log(`[Edu] Saving student profile to: ${cwd}`)

	// 写入失败时向上抛出，webview 会显示具体失败原因
	await writeEduProfile(cwd, {
		grade: Number(profile.grade) || 1,
		term: Number(profile.term) || 1,
		subjects: (profile.subjects ?? []).map((s) => ({
			subject: s.subject,
			version: s.version || "people",
			customVersion: s.customVersion,
		})),
	})

	// 刷新 webview 状态：getStateToPostToWebview 会重新读取 profile.json，
	// 推送成功后 webview 即可从教育引导向导进入聊天界面
	await controller.postStateToWebview()
	return Empty.create({})
}
