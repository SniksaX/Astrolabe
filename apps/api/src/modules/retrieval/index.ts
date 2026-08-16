// Public interface of the retrieval module — every cross-module reference must go through here.
export { retrievalRouter } from './router.js';
export { retrievalService, RetrievalService } from './service.js';
export { fuseResults, type FusionOptions } from './fusion.js';
