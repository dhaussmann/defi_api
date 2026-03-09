export const logApiRequest = (method: string, url: string, params?: unknown): void => {
	const formattedParams = params
		? typeof params === "object"
			? JSON.stringify(params)
			: String(params)
		: undefined;
	console.log(
		`[API Request] ${method} ${url}${formattedParams ? ` - Params: ${formattedParams}` : ""}`,
	);
};

export const logApiResponse = (
	method: string,
	url: string,
	status: number,
	duration: number,
): void => {
	console.log(`[API Response] ${method} ${url} ${status} - ${duration}ms`);
};

export const logApiError = (
	method: string,
	url: string,
	error: any,
	duration?: number,
): void => {
	const status = error?.response?.status || "unknown";
	console.error(
		`[API Error] ${method} ${url} ${status} - ${error?.message || "Unknown error"}${duration ? ` - ${duration}ms` : ""}`,
	);
};
