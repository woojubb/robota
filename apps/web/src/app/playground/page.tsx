"use client";

import type { IEventService, ILogger } from '@robota-sdk/agents';
import { PlaygroundApp } from '@robota-sdk/playground';
import type { IWorkflowEventSubscriber } from '@robota-sdk/workflow';
import { WorkflowEventServiceBridge } from '@robota-sdk/workflow';

export default function PlaygroundPage() {
    const createEventService = (workflowSubscriber: IWorkflowEventSubscriber, logger: ILogger): IEventService => {
        return new WorkflowEventServiceBridge(workflowSubscriber, logger);
    };
    return <PlaygroundApp createEventService={createEventService} />;
} 