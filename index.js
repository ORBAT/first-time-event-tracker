async function setupPlugin({ config, global }) {
    global.eventsToTrack = new Set(config.events.split(','))
}

async function processEvent(event, { global, storage }) {
    if (event.event === 'session_started') {
        return event
    }

    const THIRTY_MINUTES = 1000*60*30
    const timestamp = event.timestamp || event.data?.timestamp || event.properties?.timestamp || event.now || event.sent_at
    const userLastSeen = await storage.get(`last_seen_${event.distinct_id}`)
    let isFirstEventInSession = false

    if (timestamp) {
        const parsedTimestamp = new Date(timestamp).getTime()
        const timeSinceLastSeen = parsedTimestamp - (userLastSeen || 0)
        isFirstEventInSession = timeSinceLastSeen > THIRTY_MINUTES
        storage.set(`last_seen_${event.distinct_id}`, parsedTimestamp)

        if (isFirstEventInSession) {
            posthog.capture(
                'session_started', 
                { 
                    distinct_id: event.distinct_id, 
                    time_since_last_seen: timeSinceLastSeen,
                    timestamp: timestamp, // backdate to when session _actually_ started
                    trigger_event: event.event
                }
            )
        }
        
    }

    event.properties['is_first_event_in_session'] = isFirstEventInSession

    if (global.eventsToTrack.has(event.event)) {
        if (!event.properties) {
            event.properties = {}
        }
        const eventSeenBefore = await storage.get(event.event)
        const eventSeenBeforeForUser = await storage.get(`${event.event}_${event.distinct_id}`)
        event.properties['is_first_event_ever'] = !eventSeenBefore
        event.properties['is_first_event_for_user'] = !eventSeenBeforeForUser

        if (!eventSeenBeforeForUser) {
            storage.set(`${event.event}_${event.distinct_id}`, true)
            if (!eventSeenBefore) {
                storage.set(event.event, true)
            }
        }


    }

    return event
}

module.exports = {
    setupPlugin,
    processEvent,
}