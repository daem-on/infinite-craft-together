import { getPair } from "../../providers/nealfun.ts";

const db = await Deno.openKv();

export type ServerMessage = {
	type: "add";
	nouns: Noun[];
} | {
	type: "discovery";
	noun: Noun;
	scope: "global" | "local";
} | {
	type: "existing";
	noun: Noun;
};

export type ClientMessage = {
	type: "pair";
	first: string;
	second: string;
};

export type Noun = {
	name: string;
	emoji: string;
}

function sendMessage(socket: WebSocket, message: ServerMessage) {
	socket.send(JSON.stringify(message));
}

const listKey = ["nouns"];
const updateKey = ["update"];

class AsyncReader<T> {
	private reader: ReadableStreamDefaultReader<[T]>;

	constructor(stream: ReadableStream<[T]>) {
		this.reader = stream.getReader();
	}

	async start(onMessage: (message: T) => void) {
		while (true) {
			const update = await this.reader.read();
			if (update.done) break;
			const [message] = update.value;
			onMessage(message);
		}
	}

	cancel() {
		this.reader.cancel();
	}
}

export const handler = async (req: Request): Promise<Response> => {
	const upgrade = req.headers.get("upgrade") || "";
	if (upgrade.toLowerCase() != "websocket") {
			return new Response("request isn't trying to upgrade to websocket.");
	}

	const { socket, response } = Deno.upgradeWebSocket(req);

	const url = new URL(req.url);
	
	await initServer(socket, url);

	return response;
}

async function readList() {
	return await Array.fromAsync(db.list<Noun>({ prefix: listKey }));
}

async function storeNoun(noun: Noun) {
	await db.set([...listKey, noun.name], noun);
	await db.set(updateKey, [Date.now()]);
}

function seedDb() {
	return Promise.all([
		{ emoji: "💧", name: "Water" },
		{ emoji: "🔥", name: "Fire" },
		{ emoji: "🌬️", name: "Wind" },
		{ emoji: "🌍", name: "Earth" },
	].map(storeNoun));
}

async function initServer(socket: WebSocket, _url: URL) {
	const initialList = await readList();
	const state = new Map(initialList.map(entry => [entry.value.name, entry.value]));

	if (initialList.length === 0) {
		await seedDb();
	}

	sendMessage(socket, { type: "add", nouns: initialList.map(entry => entry.value) });
	
	const updateReader = new AsyncReader(db.watch<[number]>([updateKey]));
	updateReader.start(async () => {
		const list = await readList();
		const added = [];
		for (const entry of list) {
			if (!state.has(entry.value.name)) {
				state.set(entry.value.name, entry.value);
				added.push(entry.value);
			}
		}
		if (added.length > 0) sendMessage(socket, { type: "add", nouns: added });
	});

	socket.onmessage = async event => {
		const message = JSON.parse(event.data) as ClientMessage;
		if (message.type === "pair") {
			const response = await getPair(message.first, message.second);
			const noun = { name: response.result, emoji: response.emoji };
			if (!state.has(response.result)) {
				await storeNoun(noun);
				sendMessage(socket, {
					type: "discovery",
					scope: response.isNew ? "global" : "local",
					noun,
				});
			} else {
				sendMessage(socket, {
					type: "existing",
					noun,
				});
			}
		}
	};

	const cleanup = () => {
		updateReader.cancel();
		socket.close();
	};

	socket.onclose = socket.onerror = cleanup;
}
