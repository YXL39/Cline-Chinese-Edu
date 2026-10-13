import { MessageSquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { NewTaskRequest } from "@shared/proto/cline/task"
import { TaskServiceClient } from "@/services/grpc-client"

/**
 * Cline Chinese Edu：从主聊天打开子聊天（文化常识快问快答）。
 * 子聊天使用受限提示词（只答常识快问、不维护学习数据），且不出现在任务历史中。
 */
const SubChatButton: React.FC<{ className?: string }> = ({ className }) => {
	const openSubChat = (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		TaskServiceClient.newTask(
			NewTaskRequest.create({
				text: "子聊天模式：文化常识快问快答。请简短回答学生提出的文化常识 / 人文常识快问（300 字以内）。",
				images: [],
				files: [],
				variant: "sub",
			}),
		).catch((error) => {
			console.error("Failed to open edu sub-chat", error)
		})
	}

	return (
		<Tooltip>
			<TooltipContent side="left">子聊天（文化常识快问快答）</TooltipContent>
			<TooltipTrigger className={cn("flex items-center", className)}>
				<Button aria-label="子聊天" onClick={openSubChat} size="icon" variant="icon">
					<MessageSquareIcon />
				</Button>
			</TooltipTrigger>
		</Tooltip>
	)
}

export default SubChatButton