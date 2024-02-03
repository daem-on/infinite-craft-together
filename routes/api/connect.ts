import { getPair } from "../../providers/nealfun.ts";
import { ulid } from "https://deno.land/x/ulid@v0.3.0/mod.ts";

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
	if (socket.readyState !== WebSocket.OPEN) return;
	socket.send(JSON.stringify(message));
}

const dbVersion = 1;
const listName = "nouns";
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

/** Set of existing nouns, shared across clients */
const existing = new Set<string>();

async function readList(after: string) {
	return await Array.fromAsync(db.list<Noun>({
		prefix: [listName],
		start: [listName, after]
	}));
}

async function storeNoun(noun: Noun) {
	const now = ulid();
	await db.set([listName, now], noun);
	await db.set(updateKey, [now]);
}

async function ensureDbVersion() {
	const version = await db.get<number>(["version"]);
	if (version.value !== dbVersion) {
		console.log("Database version mismatch, clearing database");
		const all = db.list({ prefix: [] })
		for await (const entry of all) {
			await db.delete(entry.key);
		}
		await db.set(["version"], dbVersion);
	}
}
await ensureDbVersion();

function seedDb() {
	return Promise.all([
		{ emoji: "💧", name: "Water" },
		{ emoji: "🔥", name: "Fire" },
		{ emoji: "🌬️", name: "Wind" },
		{ emoji: "🌍", name: "Earth" },
	].map(storeNoun));
}

const iterator = db.list({ prefix: [listName] }, { limit: 1 });
if ((await iterator.next()).done) {
	console.log("Seeding database");
	await seedDb();
}

async function initServer(socket: WebSocket, _url: URL) {
	const initialList = await readList("");
	let lastUpdate = ulid();

	if (existing.size < initialList.length) {
		for (const entry of initialList) {
			existing.add(entry.value.name);
		}
	}

	sendMessage(socket, { type: "add", nouns: initialList.map(entry => entry.value) });
	
	const updateReader = new AsyncReader(db.watch([updateKey]));
	updateReader.start(async () => {
		const added = await readList(lastUpdate);
		lastUpdate = ulid();
		if (added.length > 0) {
			sendMessage(socket, {
				type: "add",
				nouns: added.map(entry => entry.value)
			});
			for (const entry of added) {
				existing.add(entry.value.name);
			}
		}
	});

	socket.onmessage = async event => {
		const message = JSON.parse(event.data) as ClientMessage;
		if (message.type === "pair") {
			const response = await getPair(message.first, message.second);
			const noun = { name: response.result, emoji: response.emoji };
			if (!existing.has(response.result)) {
				existing.add(response.result);
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
