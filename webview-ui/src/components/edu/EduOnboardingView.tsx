import type { EduStudentProfile } from "@shared/EduStudentProfile"
import {
	EduSchoolProgress as EduSchoolProgressProto,
	EduStudentProfile as EduStudentProfileProto,
	EduStudentProfileRequest,
	EduSubjectInfo as EduSubjectInfoProto,
} from "@shared/proto/cline/state"
import { Plus, Save, X } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StateServiceClient } from "@/services/grpc-client"
import { buildSubjectsForGrade, displaySubjectName, EDITION_OPTIONS, GRADES, gradeLabel } from "./eduCurriculum"

interface EduOnboardingViewProps {
	/** 编辑模式：预填已有档案 */
	initialProfile?: EduStudentProfile
	/** 紧凑显示（设置页内嵌） */
	compact?: boolean
	/** 保存成功后的回调，携带已保存的档案（用于上层立即进入聊天界面） */
	onSaved?: (profile: EduStudentProfile) => void
}

interface SubjectRow {
	subject: string
	version: string
	customVersion?: string
}

const EduOnboardingView = ({ initialProfile, compact = false, onSaved }: EduOnboardingViewProps) => {
	const [step, setStep] = useState(initialProfile?.subjects?.length ? 1 : 0)
	const [grade, setGrade] = useState<number>(initialProfile?.grade ?? 1)
	const [term, setTerm] = useState<number>(initialProfile?.term ?? 1)
	const [subjects, setSubjects] = useState<SubjectRow[]>(
		initialProfile?.subjects?.length
			? initialProfile.subjects.map((s) => ({ subject: s.subject, version: s.version, customVersion: s.customVersion }))
			: buildSubjectsForGrade(initialProfile?.grade ?? 1),
	)
	const [newSubject, setNewSubject] = useState("")
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [saved, setSaved] = useState(false)

	const changeGrade = (g: number) => {
		setGrade(g)
		setSubjects(buildSubjectsForGrade(g))
	}

	const updateSubject = (index: number, patch: Partial<SubjectRow>) => {
		setSubjects((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
	}

	const addSubject = () => {
		const name = newSubject.trim()
		if (!name || subjects.some((s) => s.subject === name)) {
			return
		}
		setSubjects((prev) => [...prev, { subject: name, version: "people" }])
		setNewSubject("")
	}

	const removeSubject = (index: number) => {
		setSubjects((prev) => prev.filter((_, i) => i !== index))
	}

	/** 保存时保留同学科的 v2 学校进度（schoolProgress 由聊天页「推进」按钮维护） */
	const pickSchoolProgress = (s: SubjectRow) => {
		const sp = initialProfile?.subjects.find((o) => o.subject === s.subject && o.version === s.version)?.schoolProgress
		return sp
			? EduSchoolProgressProto.create({
					current: sp.current || "",
					completedUnits: sp.completedUnits || [],
				})
			: undefined
	}

	const handleSave = async () => {
		if (subjects.length === 0) {
			setError("请至少保留一个科目")
			return
		}
		setSaving(true)
		setError(null)
		setSaved(false)
		try {
			await StateServiceClient.saveEduStudentProfile(
				EduStudentProfileRequest.create({
					eduStudentProfile: EduStudentProfileProto.create({
						grade,
						term,
						subjects: subjects.map((s) =>
							EduSubjectInfoProto.create({
								subject: s.subject,
								version: s.version,
								customVersion: s.version === "custom" ? s.customVersion : undefined,
								schoolProgress: pickSchoolProgress(s),
							}),
						),
					}),
				}),
			)
			// 构造共享类型档案，通知上层立即完成向导（不等状态流推送也可进入聊天界面）
			const savedProfile: EduStudentProfile = {
				grade,
				term,
				subjects: subjects.map((s) => ({
					subject: s.subject,
					version: s.version,
					customVersion: s.version === "custom" ? s.customVersion : undefined,
					schoolProgress: initialProfile?.subjects.find((o) => o.subject === s.subject && o.version === s.version)
						?.schoolProgress,
				})),
				completedAt: Date.now(),
			}
			setSaved(true)
			onSaved?.(savedProfile)
		} catch (e) {
			console.error("Failed to save edu student profile", e)
			const reason = e instanceof Error && e.message ? e.message : "请重试"
			setError(`保存失败：${reason}`)
		} finally {
			setSaving(false)
		}
	}

	return (
		<div className={`flex flex-col gap-4 overflow-auto p-4 ${compact ? "w-full" : "mx-auto w-full max-w-2xl"}`}>
			<div className="flex items-center gap-2 text-lg font-semibold text-foreground">
				{initialProfile ? "修改学生信息" : "认识一下这位学生"}
			</div>

			{/* 第 1 步：年级 + 学期 */}
			<div className="flex flex-col gap-3">
				<div className="text-sm text-muted-foreground">年级</div>
				<div className="flex flex-wrap gap-2">
					{GRADES.map((g) => (
						<button
							className={`rounded border px-2.5 py-1.5 text-sm ${
								grade === g
									? "border-foreground bg-accent font-semibold"
									: "border-muted-foreground/30 hover:bg-accent/50"
							}`}
							key={g}
							onClick={() => changeGrade(g)}
							type="button">
							{gradeLabel(g)}
						</button>
					))}
				</div>
				<div className="text-sm text-muted-foreground">学期</div>
				<div className="flex gap-2">
					<button
						className={`rounded border px-3 py-1.5 text-sm ${
							term === 1
								? "border-foreground bg-accent font-semibold"
								: "border-muted-foreground/30 hover:bg-accent/50"
						}`}
						onClick={() => setTerm(1)}
						type="button">
						上学期
					</button>
					<button
						className={`rounded border px-3 py-1.5 text-sm ${
							term === 2
								? "border-foreground bg-accent font-semibold"
								: "border-muted-foreground/30 hover:bg-accent/50"
						}`}
						onClick={() => setTerm(2)}
						type="button">
						下学期
					</button>
				</div>
			</div>

			{/* 第 2 步：科目与教材 */}
			<div className="flex flex-col gap-3">
				<div className="text-sm text-muted-foreground">{gradeLabel(grade)}的科目（教材版本可按科目调整）</div>
				<div className="flex flex-col gap-2">
					{subjects.map((s, i) => (
						<div className="flex flex-wrap items-center gap-2" key={`${s.subject}-${i}`}>
							<span className="w-24 shrink-0 text-sm text-foreground">
								{displaySubjectName(s.subject, s.version)}
							</span>
							<select
								className="h-8 rounded border border-muted-foreground/30 bg-background px-2 text-sm"
								onChange={(e) => updateSubject(i, { version: e.target.value, customVersion: undefined })}
								value={s.version}>
								{EDITION_OPTIONS.map((o) => (
									<option key={o.key} value={o.key}>
										{o.label}
									</option>
								))}
							</select>
							{s.version === "custom" && (
								<Input
									className="h-8 w-40 text-sm"
									onChange={(e) => updateSubject(i, { customVersion: e.target.value })}
									placeholder="输入自定义教材名称"
									value={s.customVersion ?? ""}
								/>
							)}
							<span className="flex-1" />
							<Button aria-label={`移除${s.subject}`} onClick={() => removeSubject(i)} size="sm" variant="ghost">
								<X className="h-4 w-4" />
							</Button>
						</div>
					))}
				</div>
				<div className="flex items-center gap-2">
					<Input
						className="h-8 text-sm"
						onChange={(e) => setNewSubject(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								addSubject()
							}
						}}
						placeholder="添加其他科目，如：音乐"
						value={newSubject}
					/>
					<Button disabled={!newSubject.trim()} onClick={addSubject} size="sm">
						<Plus className="h-4 w-4" />
						添加
					</Button>
				</div>
			</div>

			{error && <div className="text-sm text-red-400">{error}</div>}
			{saved && <div className="text-sm text-green-400">已保存，学习信息将随聊天自动生效</div>}

			<div className="flex items-center gap-2 pt-2">
				{step === 1 && (
					<Button onClick={() => setStep(0)} variant="secondary">
						返回
					</Button>
				)}
				{step === 0 ? (
					<Button onClick={() => setStep(1)}>下一步</Button>
				) : (
					<Button disabled={saving} onClick={handleSave}>
						<Save className="mr-1 h-4 w-4" />
						{initialProfile ? "保存修改" : "开始学习"}
					</Button>
				)}
			</div>
		</div>
	)
}

export default EduOnboardingView
