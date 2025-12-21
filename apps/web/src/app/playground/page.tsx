"use client";

import { PlaygroundApp, WorkflowSubscriberEventService } from '@robota-sdk/playground';
import type { EventService, SimpleLogger } from '@robota-sdk/agents';
import type { WorkflowEventSubscriber } from '@robota-sdk/workflow';

export default function PlaygroundPage() {
    const createEventService = (workflowSubscriber: WorkflowEventSubscriber, logger: SimpleLogger): EventService => {
        return new WorkflowSubscriberEventService(workflowSubscriber, logger);
    };
    return <PlaygroundApp createEventService={createEventService} />;
} 