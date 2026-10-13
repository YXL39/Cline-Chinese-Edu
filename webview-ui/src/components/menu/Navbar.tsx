import { SettingsIcon, UserCircleIcon } from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "../../context/ExtensionStateContext"

// Custom MCP Server Icon component using VSCode codicon
const McpServerIcon = ({ className, size }: { className?: string; size?: number }) => (
	<span
		className={`codicon codicon-server flex items-center ${className || ""}`}
		style={{ fontSize: size ? `${size}px` : "12.5px", marginBottom: "1px" }}
	/>
)

export const Navbar = () => {
	const { t } = useTranslation("misc")
	const { navigateToSettings, navigateToAccount, navigateToMcp } = useExtensionState()

	const SETTINGS_TABS = useMemo(
		() => [
			// Cline Chinese Edu: 单主聊天模式 —— 隐藏「新任务」与「任务历史」入口，
			// 所有主交互收敛到自动续接的主聊天；子聊天由任务头部的「子聊天」按钮进入。
			{
				id: "mcp",
				name: "MCP",
				tooltip: t("navbar.mcpServers"),
				icon: McpServerIcon,
				navigate: navigateToMcp,
			},
			{
				id: "account",
				name: "Account",
				tooltip: t("navbar.account"),
				icon: UserCircleIcon,
				navigate: navigateToAccount,
			},
			{
				id: "settings",
				name: "Settings",
				tooltip: t("navbar.settings"),
				icon: SettingsIcon,
				navigate: navigateToSettings,
			},
		],
		[navigateToAccount, navigateToMcp, navigateToSettings, t],
	)

	return (
		<nav
			className="flex-none inline-flex justify-end bg-transparent gap-2 mb-1 z-10 border-none items-center mr-4!"
			id="cline-navbar-container">
			{SETTINGS_TABS.map((tab) => (
				<Tooltip key={`navbar-tooltip-${tab.id}`}>
					<TooltipContent side="bottom">{tab.tooltip}</TooltipContent>
					<TooltipTrigger asChild>
						<Button
							aria-label={tab.tooltip}
							className="p-0 h-7"
							data-testid={`tab-${tab.id}`}
							key={`navbar-button-${tab.id}`}
							onClick={() => tab.navigate()}
							size="icon"
							variant="icon">
							<tab.icon className="stroke-1 [svg]:size-4" size={18} />
						</Button>
					</TooltipTrigger>
				</Tooltip>
			))}
		</nav>
	)
}
