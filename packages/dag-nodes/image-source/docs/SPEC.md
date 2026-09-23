# Image Source Node Specification

## Purpose

A DAG source node (no inputs) that emits a binary image payload from a configured asset reference,
for test and development workflows.

## Contract

- Output accepts PNG, JPEG, and WebP image payloads.
- MIME type resolution order: config override > reference media type > `image/png` default.

## Non-goals

- No external provider dependencies; does not redefine core DAG contracts.
