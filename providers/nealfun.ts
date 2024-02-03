type PairResponse = {
	emoji: string;
	isNew: boolean;
	result: string;
};

// Thanks, Neal!

export async function getPair(first: string, second: string) {
	const response = await fetch(
		`https://neal.fun/api/infinite-craft/pair?first=${first}&second=${second}`,
		{
			headers: {
				"Accept": "*/*",
				"Accept-Encoding": "gzip, deflate, br",
				"Referer": "https://neal.fun/infinite-craft/",
			},
			method: "GET",
		}
	);
	if (!response.ok) throw new Error(response.statusText);
	return await response.json() as PairResponse;
}