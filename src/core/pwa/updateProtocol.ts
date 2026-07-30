export const GET_DEPLOYMENT_METADATA = 'GET_DEPLOYMENT_METADATA' as const;

export interface DeploymentMetadata {
    hash: string;
}