async function setupPlugin({ config, global }) {
    const trim = Function.prototype.call.bind(String.prototype.trim)
    global.eventsToTrack = new Set(config.events.split(',').map(trim))
}

async function processEvent(event, { global, storage }) {
    const sessStartEvent = 'session.start'
    if (event.event === sessStartEvent) {
        return event
    }

    if (!event.properties) {
        event.properties = {}
    }

    const THIRTY_MINUTES = 1000 * 60 * 30
    const timestamp =
        event.timestamp || event.data?.timestamp || event.properties.timestamp || event.now || event.sent_at

    if (timestamp) {
        const userLastSeenKey = `last_seen_${event.distinct_id}`
        const userLastSeen = await storage.get(userLastSeenKey)

        const parsedTimestamp = new Date(timestamp).getTime()
        const timeSinceLastSeen = parsedTimestamp - (userLastSeen || 0)
        let isFirstEventInSession = timeSinceLastSeen > THIRTY_MINUTES
        storage.set(userLastSeenKey, parsedTimestamp)

        if (isFirstEventInSession) {
            event.properties['session.first.event'] = true
            const prevSessStartKey = `prev_session_start_${event.distinct_id}`
            const props = {
                distinct_id: event.distinct_id,
                timestamp: timestamp, // backdate to when session _actually_ started
                'event.trigger': event.event,
            }
            if (userLastSeen) {
                const prevSessStart = await storage.get(prevSessStartKey)
                if (prevSessStart) {
                    props['session.previous.length.seconds'] = (parsedTimestamp - prevSessStart) * 1000
                }
                props['last-seen'] = new Date(userLastSeen).toISOString()
                props['last-seen.elapsed-since.seconds'] = timeSinceLastSeen * 1000
            }
            posthog.capture(sessStartEvent, props)
            storage.set(prevSessStartKey, parsedTimestamp)
        }
    }

    if (global.eventsToTrack.has(event.event)) {
        const eventSeenBeforeForUser = await storage.get(`${event.event}_${event.distinct_id}`)
        event.properties['event.first.for.user'] = !eventSeenBeforeForUser

        if (!eventSeenBeforeForUser) {
            storage.set(`${event.event}_${event.distinct_id}`, true)
        }
    }

    return event
}

module.exports = {
    setupPlugin,
    processEvent,
}
