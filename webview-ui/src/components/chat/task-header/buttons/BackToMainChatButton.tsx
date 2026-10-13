import { HomeIcon } from "lucide-react"
import { StringRequest } from "@shared/proto/cline/common"
import { NewTaskRequest } from "@shared/proto/cline/task"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"

/**
 * Cline Chinese Edu：从子聊天返回主聊天（自动续接最近的主聊天任务；
 * 没有主聊天时新建一个）。
 */
const BackToMainChatButton: React.FC<{ className?: string }> = ({ className }) => {
	const { eduLastMainTaskId } = useExtensionState()

	const backToMain = (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (eduLastMainTaskId) {
			TaskServiceClient.showTaskWithId(StringRequest.create({ value: eduLastMainTaskId })).catch((error) => {
				console.error("Failed to return to main chat", error)
			})
		} else {
			TaskServiceClient.newTask(
				NewTaskRequest.create({
					text: "继续主聊天：为这位学生做讲解、练习与复习。",
					images: [],
					files: [],
				}),
			).catch((error) => {
				console.error("Failed to start main chat", error)
			})
		}
	}

	return (
		<Tooltip>
			<TooltipContent side="left">返回主聊天</TooltipContent>
			<TooltipTrigger className={cn("flex items-center", className)}>
				<Button aria-label="返回主聊天" onClick={backToMain} size="icon" variant="icon">
					<HomeIcon />
				</Button>
			</TooltipTrigger>
		</Tooltip>
	)
}

export default BackToMainChatButton