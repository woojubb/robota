---
'@robota-sdk/agent-product': patch
---

A case that closes after the person answered its question now shows its resolution on the card that carried that answer (`IFeedQuestion.resolution`, set through `GoalBook.resolveQuestion`; the case remembers that card as `lastAnsweredFeedItemId`), so a close such as "go to the service directly, not through the mail" is no longer left in the case's thread alone, and nothing new is posted to the feed.
