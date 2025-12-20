"use client";

import { PlaygroundApp } from '@/playground';
import { WorkflowSubscriberEventService } from '@/lib/playground/workflow-subscriber-event-service';
import type { EventService, SimpleLogger } from '@robota-sdk/agents';
import type { WorkflowEventSubscriber } from '@robota-sdk/workflow';

export default function PlaygroundPage() {
    const createEventService = (workflowSubscriber: WorkflowEventSubscriber, logger: SimpleLogger): EventService => {
        return new WorkflowSubscriberEventService(workflowSubscriber, logger);
    };
    return <PlaygroundApp createEventService={createEventService} />;
} 