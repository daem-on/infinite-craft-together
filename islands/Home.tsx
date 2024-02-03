import { signal } from "@preact/signals";
import { ClientMessage, Noun, ServerMessage } from "../routes/api/connect.ts";

enum ConnectionStatus {
	CONNECTING,
	CONNECTED,
	DISCONNECTED,
}

const isServerSide = typeof location === "undefined";

const status = signal<ConnectionStatus>(ConnectionStatus.CONNECTING);
const stateDisplay = signal<Noun[] | undefined>(undefined);
const selectedNoun = signal<Noun | undefined>(undefined);
const discovery = signal<string | undefined>(undefined);
const highlighted = signal<Noun | undefined>(undefined);

let ws: WebSocket | undefined;

const state = new Map<string, Noun>();

function connect() {
	const url = new URL(location.href);
	url.protocol = url.protocol.replace("http", "ws");
	url.pathname = "/api/connect";

	ws = new WebSocket(url.href);
	ws.onopen = () => {
		status.value = ConnectionStatus.CONNECTED;
	}

	ws.onmessage = (event) => {
		const message = JSON.parse(event.data) as ServerMessage;
		if (message.type === "add") {
			for (const noun of message.nouns) {
				state.set(noun.name, noun);
			}
			stateDisplay.value = Array.from(state.values());
		} else if (message.type === "discovery") {
			discovery.value = `Discovered ${ message.noun.emoji } ${message.noun.name}! (${message.scope})`;
			highlighted.value = message.noun;
		} else if (message.type === "existing") {
			highlighted.value = message.noun;
		}
	}

	ws.onclose = ws.onerror = ev => {
		console.log("disconnected", ev);
		status.value = ConnectionStatus.DISCONNECTED;
		ws = undefined;
	}
}

function send(message: ClientMessage) {
	if (ws !== undefined) ws.send(JSON.stringify(message));
}

function pair(first: Noun, second: Noun) {
	if (first.name > second.name) [first, second] = [second, first];
	send({ type: "pair", first: first.name, second: second.name });
}

function nounClicked(noun: Noun) {
	const selected = selectedNoun.value;
	if (selected === undefined) {
		selectedNoun.value = noun;
	} else {
		selectedNoun.value = undefined;
		pair(selected, noun);
	}
}

function getBackgroundColor(selected: boolean, highlighted: boolean) {
	if (selected) return "#ffcc00";
	if (highlighted) return "#f0f0f0";
	return "white";
}

export default function Home() {
	if (!isServerSide && status.value === ConnectionStatus.CONNECTING) connect();

	return (
		<div class="m-3">
			<div class="flex flex-row justify-between">
				<h1 class="text-xl">InfiniteCraftTogether v3</h1>
				<h2>
					Connected: {status.value === ConnectionStatus.CONNECTED ? "Yes" : "No"}
				</h2>
			</div>
			{
				discovery.value && <p class="text-sm border-1 rounded-md p-2 bg-gray-100 sticky top-0 flex flex-row justify-between">
					{ discovery.value }
					<button class="ml-2" onClick={() => discovery.value = undefined}>X</button>
				</p>
			}
			<div class="flex flex-wrap">
				{stateDisplay.value?.map(noun => (
					<div
						class="cursor-pointer hover:bg-gray-100 py-1 px-2 rounded-md m-1 w-fit border border-gray-400 select-none"
						key={noun.name}
						onClick={() => nounClicked(noun)}
						style={{
							background: getBackgroundColor(
								noun.name === selectedNoun.value?.name,
								noun.name === highlighted.value?.name
							)
						}}>

						{ noun.emoji } { noun.name }

					</div>
				))}
			</div>
		</div>
	);
}
