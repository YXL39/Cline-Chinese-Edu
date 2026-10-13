export type HistoryItem = {
	id: string
	ulid?: string // ULID for better tracking and metrics
	ts: number
	task: string
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number

	size?: number
	shadowGitConfigWorkTree?: string
	cwdOnTaskInitialization?: string
	conversationHistoryDeletedRange?: [number, number]
	isFavorited?: boolean
	checkpointManagerErrorMessage?: string

	modelId?: string
	/** Cline Chinese Edu: 子聊天任务（常识速问），不出现在任务历史中 */
	isSubChat?: boolean
}
