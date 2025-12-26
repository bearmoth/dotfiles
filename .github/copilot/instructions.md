# GitHub Copilot Instructions for StakeEngine Development

## Overview

This repository contains development environment configurations (dotfiles) for StakeEngine game development. The StakeEngine documentation is stored locally in the `docs/stake-engine/` directory for reference during development.

## StakeEngine Documentation Structure

The StakeEngine documentation is organized into the following sections:

### 1. Getting Started
- **Location**: `docs/stake-engine/getting-started/`
- **Topics**: Introduction, RGS Details, Wallet Endpoints, Basic RGS Examples
- **Use for**: Understanding the Remote Game Server (RGS) integration and basic setup

### 2. Front End Development
- **Location**: `docs/stake-engine/front-end/`
- **Topics**: Dependencies, Getting Started, Storybook, Flowchart, Task Breakdown, Events, File Structure, Context, UI
- **Use for**: Building game user interfaces and client-side logic

### 3. Math/Game Logic
- **Location**: `docs/stake-engine/math/`
- **Topics**: Setup, Quickstart, Math File Format, State Machine, Game Structure, Symbols, Board, Wins, Events, Force Files, Utilities, Example Games, Optimization
- **Use for**: Implementing game mathematics, probability calculations, and outcome determination

### 4. Approval Guidelines
- **Location**: `docs/stake-engine/approval-guidelines/`
- **Topics**: General Requirements, Game Quality Rankings, RGS Communication, Front End Communication, Math Verification, Game Tile Requirements, Disclaimers, Jurisdiction Requirements
- **Use for**: Ensuring compliance with platform standards before publishing

### 5. Legal
- **Location**: `docs/stake-engine/legal/`
- **Topics**: Terms & Conditions, Privacy Policy
- **Use for**: Understanding legal requirements and compliance

## StakeEngine SDK References

### ts-client
- **Repository**: https://github.com/StakeEngine/ts-client
- **Purpose**: TypeScript client library - **INSTALLABLE** in applications
- **Usage**: This is a production dependency that can be installed via npm/yarn in your game projects
- **Installation**: `npm install @stake-engine/ts-client` (or similar)

### web-sdk
- **Repository**: https://github.com/StakeEngine/web-sdk
- **Purpose**: Example monorepo containing example games - **REFERENCE ONLY**
- **Usage**: This is NOT installable. It contains example implementations for reference when building games
- **Note**: Do not attempt to import or install this as a dependency

### math-sdk
- **Repository**: https://github.com/StakeEngine/math-sdk
- **Purpose**: Math verification tool - **DEVELOPMENT TOOL**
- **Usage**: Used to prove outcome probability before publishing games
- **Note**: This is a verification/testing tool, not a runtime dependency

## Guidelines for Copilot

When working with StakeEngine development:

1. **Reference Local Documentation**: Always refer to the local documentation in `docs/stake-engine/` rather than attempting to access remote URLs
2. **SDK Clarity**: 
   - Only suggest installing `ts-client` as a production dependency
   - Reference `web-sdk` examples but never suggest installing it
   - Recommend `math-sdk` for verification tasks only
3. **Documentation Organization**: Documentation is split by topic to keep context focused and relevant
4. **Example Code**: When providing examples, base them on the patterns documented in the local reference materials

## Development Workflow

1. Consult the appropriate documentation section based on the task
2. Follow patterns and conventions outlined in the documentation
3. Use the ts-client SDK for API integration
4. Reference web-sdk examples for implementation patterns
5. Verify game math with math-sdk before deployment
6. Ensure compliance with approval guidelines before publishing
