---
'@robota-sdk/agent-product': minor
---

The personal pack gains `TaskOfferPropose` (`createOfferTools`, `OFFER_TOOL_NAMES`, `IOfferProposer`, `IOfferCandidate`): the agent proposes that the person run an installed task because of something it read, and the tool only hands the proposal to a port the host supplies and returns the host's answer. It is on the tool lists of a sync run and of a case turn (`syncRunTools`, `caseTurnTools`). `carriesSecretValue`, the check that judges text by the value it carries and not by its vocabulary, is now exported for hosts that keep plain-word text such as an offer's reason.
