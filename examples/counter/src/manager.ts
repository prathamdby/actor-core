import { assertUnreachable } from "@rivet-gg/actor-common/utils";
import type { ActorTags } from "@rivet-gg/actor-common/utils";
import type { ManagerDriver } from "@rivet-gg/actor-manager";
import type { ActorsRequest, ActorsResponse } from "@rivet-gg/manager-protocol";
import type { CreateRequest } from "@rivet-gg/manager-protocol/query";
import { logger } from "./log";

export interface ActorState {
	tags: ActorTags;
	destroyedAt?: number;
}

function buildActorEndpoint(actorId: string) {
	// TODO: Remove hardcoded host
	return `http://localhost:8787/actors/${actorId}`;
}

export function buildManager(env: Env): ManagerDriver {
	return {
		async queryActor({ query }: ActorsRequest): Promise<ActorsResponse> {
			logger().debug("query", { query });
			if ("getForId" in query) {
				// TODO: Error handling

				//// Validate actor
				//if ((res.actor.tags as ActorTags).access !== "public") {
				//	// TODO: Throw 404 that matches the 404 from Fern if the actor is not found
				//	throw new Error(`Actor with ID ${query.getForId.actorId} is private`);
				//}
				//if (res.actor.destroyedAt) {
				//	throw new Error(
				//		`Actor with ID ${query.getForId.actorId} already destroyed`,
				//	);
				//}
				//
				//return res.actor;

				return { endpoint: buildActorEndpoint(query.getForId.actorId) };
			}
			if ("getOrCreateForTags" in query) {
				const tags = query.getOrCreateForTags.tags;
				if (!tags) throw new Error("Must define tags in getOrCreateForTags");

				const existingActor = await getWithTags(env, tags as ActorTags);
				if (existingActor) {
					// Actor exists
					return existingActor;
				}

				if (query.getOrCreateForTags.create) {
					// Create if needed
					return await createActor(env, query.getOrCreateForTags.create);
				}
				// Creation disabled
				throw new Error("Actor not found with tags or is private.");
			}
			if ("create" in query) {
				return await createActor(env, query.create);
			}
			assertUnreachable(query);
		},
	};
}

async function getWithTags(
	env: Env,
	tags: ActorTags,
): Promise<ActorsResponse | undefined> {
	// TODO: use an inverse tree for correct tag looups

	const actorId = await env.ACTOR_KV.get(
		`actor:tags:${JSON.stringify(tags)}:id`,
	);
	if (actorId) {
		return { endpoint: buildActorEndpoint(actorId) };
	}
	return undefined;

	//// TODO(RVT-4248): Don't return actors that aren't networkable yet
	//actors = actors.filter((a) => {
	//	// This should never be triggered. This assertion will leak if private actors exist if it's ever triggered.
	//	if ((a.tags as ActorTags).access !== "public") {
	//		throw new Error("unreachable: actor tags not public");
	//	}
	//
	//	for (const portName in a.network.ports) {
	//		const port = a.network.ports[portName];
	//		if (!port.hostname || !port.port) return false;
	//	}
	//	return true;
	//});
	//
	//if (actors.length === 0) {
	//	return undefined;
	//}
	//
	//// Make the chosen actor consistent
	//if (actors.length > 1) {
	//	actors.sort((a, b) => a.id.localeCompare(b.id));
	//}
	//
	//return actors[0];
}

async function createActor(
	env: Env,
	createRequest: CreateRequest,
): Promise<ActorsResponse> {
	logger().info("creating actor", { ...createRequest });

	const actorId = env.ACTOR_DO.newUniqueId({
		jurisdiction: createRequest.region as DurableObjectJurisdiction | undefined,
	});

	// Init actor
	const actor = env.ACTOR_DO.get(actorId);
	await actor.initialize({
		tags: createRequest.tags,
	});

	// Save tags (after init so the actor is ready)
	await env.ACTOR_KV.put(
		`actor:tags:${JSON.stringify(createRequest.tags)}:id`,
		actorId.toString(),
	);

	return { endpoint: buildActorEndpoint(actorId.toString()) };
}
