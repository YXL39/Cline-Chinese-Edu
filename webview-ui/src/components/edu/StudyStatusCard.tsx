import { eduSubjectLabel, type EduProgressFile, type EduSubjectInfo } from "@shared/EduStudentProfile"
import { EduSchoolProgressRequest } from "@shared/proto/cline/state"
import { ChevronDown, ChevronRight, Forward } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"

/**
 * Cline Chinese Edu v2「学习状态」卡片（聊天页顶部，主聊天常驻）：
 * - 按学科展示：学校进度（schoolProgress，学生维护）/ 超前学进度 / 待复习条目数
 * - 「推进」按钮：学生确认学校讲到的新位置 → 旧当前自动归档到「本学期已学」并入复习区
 */
const StudyStatusCard = () => {
	const { eduStudentProfile, eduProgress } = useExtensionState()
	const [expanded, setExpanded] = useState(true)
	const [advancingSubject, setAdvancingSubject] = useState<string | null>(null)
	const [advanceValue, setAdvanceValue] = useState("")
	const [advancing, setAdvancing] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const profile = eduStudentProfile
	const progress: EduProgressFile | undefined = (() => {
		if (!eduProgress) {
			return undefined
		}
		try {
			return JSON.parse(eduProgress) as EduProgressFile
		} catch {
			return undefined
		}
	})();

	if (!profile) {
		return null
	}

	const cancelAdvance = () => {
		setAdvancingSubject(null)
		setAdvanceValue("")
		setError(null)
	}

	const confirmAdvance = async (subject: EduSubjectInfo) => {
		const value = advanceValue.trim()
		if (!value) {
			setError("请填写学校当前讲到的位置")
			return
		}
		setAdvancing(true)
		setError(null)
		try {
			await StateServiceClient.advanceEduSchoolProgress(
				EduSchoolProgressRequest.create({
					subject: subject.subject,
					version: subject.version || "",
					newCurrent: value,
				}),
			)
			// 成功后宿主会推送最新档案与进度，卡片自动刷新
			cancelAdvance()
		} catch (e) {
			console.error("Failed to advance edu school progress", e)
			setError(e instanceof Error && e.message ? e.message : "推进失败，请重试")
		} finally {
			setAdvancing(false)
		}
	}

	return (
		<div className="mx-3 mt-2 select-none rounded-md border border-border/60 bg-(--vscode-editor-inlayHints-background) text-xs text-foreground">
			{/* 折叠头 */}
			<button
				className="flex w-full cursor-pointer items-center gap-1.5 px-2 py-1.5 text-left text-sm hover:bg-(--vscode-list-hoverBackground)"
				onClick={() => setExpanded(!expanded)}
				type="button">
				{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				<span className="font-medium">学习状态</span>
				<span className="ml-auto text-[11px] text-muted-foreground">
					{profile.term === 2 ? "下学期" : "上学期"} · {profile.subjects.length} 个科目
				</span>
			</button>

			{expanded && (
				<div className="flex flex-col gap-1 border-t border-border/40 px-2 py-1.5">
					{profile.subjects.map((s) => {
						const label = eduSubjectLabel(s)
						const sp = s.schoolProgress
						const prog = progress?.subjects.find((p) => p.subject === label)
						const pendingReview = prog?.review?.filter((r) => r.status === "pending").length ?? 0
						const isAdvancing = advancingSubject === s.subject
						return (
							<div key={`${s.subject}#${s.version}`} className="flex flex-col gap-1 rounded px-1 py-0.5">
								<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
									<span className="font-medium">{label}</span>
									<span className="text-muted-foreground">
										学校：{sp?.current ? sp.current : "未设置"}
									</span>
									<span className="text-muted-foreground">
										超前：{prog?.ahead?.current ? prog.ahead.current : "未开始"}
									</span>
									{pendingReview > 0 && (
										<span className="rounded bg-(--vscode-badge-background) px-1 text-[10px] text-(--vscode-badge-foreground)">
											待复习 {pendingReview}
										</span>
									)}
									{!isAdvancing && (
										<Button
											aria-label={`推进 ${label} 学校进度`}
											className="ml-auto h-5 gap-1 rounded px-1.5 py-0 text-[11px]"
											onClick={() => {
												setAdvancingSubject(s.subject)
												setAdvanceValue(sp?.current ?? "")
												setError(null)
											}}
											size="sm"
											variant="outline">
											<Forward size={11} />
											推进
										</Button>
									)}
								</div>
								{isAdvancing && (
									<div className="flex flex-col gap-1">
										<div className="flex flex-wrap items-center gap-1.5">
											<Input
												className="h-6 flex-1 text-xs"
												disabled={advancing}
												maxLength={80}
												onChange={(e) => setAdvanceValue(e.target.value)}
												onKeyDown={(e) => {
													if (e.key === "Enter" && !advancing) {
														void confirmAdvance(s)
													}
												}}
												placeholder="新的学校讲到位置（如：七年级上册·第四章 相交线与平行线）"
												value={advanceValue}
											/>
											<Button
												className="h-6 px-2 text-xs"
												disabled={advancing}
												onClick={() => void confirmAdvance(s)}
												size="sm">
												{advancing ? "提交中…" : "确认推进"}
											</Button>
											<Button
												className="h-6 px-2 text-xs"
												disabled={advancing}
												onClick={cancelAdvance}
												size="sm"
												variant="outline">
												取消
											</Button>
										</div>
										<div className="text-[11px] text-muted-foreground">
											推进后，旧的「学校当前」会自动归入本学期已学（进入复习区）
										</div>
										{error && <div className="text-[11px] text-red-400">{error}</div>}
									</div>
								)}
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
}

export default StudyStatusCard