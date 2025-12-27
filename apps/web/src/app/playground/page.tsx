"use client";

import { PlaygroundApp, WorkflowSubscriberEventService } from '@robota-sdk/playground';
import type { IEventService, SimpleLogger } from '@robota-sdk/agents';
import type { WorkflowEventSubscriber } from '@robota-sdk/workflow';

export default function PlaygroundPage() {
    const createEventService = (workflowSubscriber: WorkflowEventSubscriber, logger: SimpleLogger): IEventService => {
        return new WorkflowSubscriberEventService(workflowSubscriber, logger);
    };
    return <PlaygroundApp createEventService={createEventService} />;
} 