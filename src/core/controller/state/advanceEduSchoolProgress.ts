import { Empty } from "@shared/proto/cline/common"
import { EduSchoolProgressRequest } from "@shared/proto/cline/state"
import { advanceEduSchoolProgressData } from "@/core/edu/eduDataFiles"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * 推进某学科的学校进度（Cline Chinese Edu v2）：
 * 旧「当前」归档到 profile.json 的 completedUnits（本学期已学），
 * 并把对应单元入 progress.json 复习区（scope=unit, pending）。
 * 数据写入失败时向上抛出，webview 卡片会显示具体原因。
 */
export async function advanceEduSchoolProgress(
	controller: Controller,
	request: EduSchoolProgressRequest,
): Promise<Empty> {
	const subject = request?.subject?.trim()
	const newCurrent = request?.newCurrent?.trim()
	if (!subject || !newCurrent) {
		throw new Error("推进学校进度需要提供学科名和新的当前位置")
	}

	// 解析学习数据目录：优先工作区根目录，无根目录时回退到宿主当前目录
	const cwd = await controller.getEduDataCwd()
	if (!cwd) {
		throw new Error("未找到可用的工作区目录，无法推进学校进度")
	}
	Logger.log(`[Edu] Advancing school progress: ${subject} → ${newCurrent} (${cwd})`)

	await advanceEduSchoolProgressData(cwd, subject, request?.version, newCurrent)

	// 刷新 webview 状态（学习状态卡片读取最新的档案与进度）
	await controller.postStateToWebview()
	return Empty.create({})
}