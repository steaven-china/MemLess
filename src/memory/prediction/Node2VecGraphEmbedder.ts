import { GraphEmbedder } from "./GraphEmbedder.js";

// Compatibility implementation: currently reuses GraphEmbedder behavior.
// Real node2vec training is not implemented yet.
export class Node2VecGraphEmbedder extends GraphEmbedder {}
