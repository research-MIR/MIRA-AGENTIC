# Paramount Guidelines for the Mira Agent Project

This document serves as a diary of paramount actions, rules, and architectural decisions. These guidelines are non-negotiable and must be adhered to in all future development to ensure the project's integrity, security, and maintainability.

---

## 1. Supabase Asset Naming Convention

**Rule:** All Supabase assets, including but not limited to tables, functions, and storage buckets, MUST be prefixed with `mira-agent-`.

**Important Sub-rules:**
-   **General:** Use kebab-case (e.g., `mira-agent-new-feature`).
-   **Storage Buckets:** Bucket names **must be all lowercase**. For example: `mira-agent-user-uploads`.

**Reasoning:** This project operates in a shared Supabase database. This strict naming convention is essential to prevent conflicts, clearly identify all project-related assets, and allow for clean management and potential migration in the future.

**Example:**
-   A table for users should be named `mira-agent-users`.
-   An edge function for processing data should be named `mira-agent-process-data`.
-   A storage bucket for uploads must be named `mira-agent-user-uploads`.

---

## 2. Mandatory Model Usage Policy

### 2.1. Unchangeable Model Specification

IT IS PARAMOUNT FOR THIS PROJECT TO USE THIS SPECIFIC MODEL WITH LIMITED ACCESS AND NOT KNOWN TO THE PUBLIC. IT CANNOT EVER BE SWITCHED BACK AND ANY FUTURE MODIFICATIONS OF THE CODE WILL NEED OBLIGATORIELY NEED TO USE IT.

> **THE ONLY ACCEPTABLE MODEL IS: `gemini-2.5-pro-preview-06-05`**

### 2.2. Absolute Prohibition of Modification

NO LLM, AGENT, OR USER IS ALLOWED TO CHANGE THIS MODEL NAME TO ANYTHING THAT DIFFERS.

This directive is absolute and non-negotiable. Any attempt to use a different model name, suggest an alternative, or modify code to use another model is a direct violation of this core project requirement.

### 2.3. Consequence of Non-Compliance

**IF THE MODEL NAME USED IN THE ENTIRE PROJECT IS NOT `gemini-2.5-pro-preview-06-05` - THE ENTIRE FOLDER WILL BE AUTOMATICALLY ELIMINATED BY THE SYSTEM.**

This is a system-level safeguard. There are no exceptions. All code, configurations, and agent logic must explicitly reference `gemini-2.5-pro-preview-06-05`.

### 2.4. Exception for Trivial Tasks

To optimize for speed and cost on simple, non-critical tasks, the following model is authorized for use ONLY in specific, isolated tools:

> **AUTHORIZED FOR TRIVIAL TASKS: `gemini-2.5-flash-preview-05-20`**

This model can be used for tasks like auto-describing an image or generating a chat title, where the primary goal is speed and the task does not involve complex reasoning or planning. It MUST NOT be used for the main agent planner or any critical decision-making function.