import {
	type DurableObjectConstructor,
	type ActorHandlerInterface,
	createActorDurableObject,
} from "./actor_handler_do";
import { ConfigSchema, type InputConfig } from "./config";
import { assertUnreachable } from "actor-core/utils";
import type { Hono } from "hono";
import { PartitionTopologyManager } from "actor-core/topologies/partition";
import { logger } from "./log";
import { CloudflareWorkersManagerDriver } from "./manager_driver";
import { ActorCoreApp } from "actor-core";

/** Cloudflare Workers env */
export interface Bindings {
	ACTOR_KV: KVNamespace;
	ACTOR_DO: DurableObjectNamespace<ActorHandlerInterface>;
}

export function createHandler(app: ActorCoreApp<any>, inputConfig?: InputConfig): {
	handler: ExportedHandler<Bindings>;
	ActorHandler: DurableObjectConstructor;
} {
	// Create router
	const { router, ActorHandler } = createRouter(app, inputConfig);

	// Create Cloudflare handler
	const handler = {
		fetch: router.fetch,
	} satisfies ExportedHandler<Bindings>;

	return { handler, ActorHandler };
}

export function createRouter(
	app: ActorCoreApp<any>,
	inputConfig?: InputConfig,
): {
	router: Hono<{ Bindings: Bindings }>;
	ActorHandler: DurableObjectConstructor;
} {
	const driverConfig = ConfigSchema.parse(inputConfig);

	// Configur drivers
	//
	// Actor driver will get set in `ActorHandler`
	if (!driverConfig.drivers) driverConfig.drivers = {};
	if (!driverConfig.drivers.manager)
		driverConfig.drivers.manager = new CloudflareWorkersManagerDriver();

	// Create Durable Object
	const ActorHandler = createActorDurableObject(app, driverConfig);

	driverConfig.topology = driverConfig.topology ?? "partition";
	if (driverConfig.topology === "partition") {
		const managerTopology = new PartitionTopologyManager(app.config, driverConfig);

		// Force the router to have access to the Cloudflare bindings
		const router = managerTopology.router as unknown as Hono<{
			Bindings: Bindings;
		}>;

		// Forward requests to actor
		router.all("/actors/:actorId/:path{.+}", (c) => {
			const actorId = c.req.param("actorId");
			const subpath = `/${c.req.param("path")}`;
			logger().debug("forwarding request", { actorId, subpath });

			const id = c.env.ACTOR_DO.idFromString(actorId);
			const stub = c.env.ACTOR_DO.get(id);

			// Modify the path to remove the prefix
			const url = new URL(c.req.url);
			url.pathname = subpath;
			const actorRequest = new Request(url.toString(), c.req.raw);

			return stub.fetch(actorRequest);
		});

		return { router, ActorHandler };
	} else if (
		driverConfig.topology === "standalone" ||
		driverConfig.topology === "coordinate"
	) {
		throw new Error("Cloudflare only supports partition topology.");
	} else {
		assertUnreachable(driverConfig.topology);
	}
}
