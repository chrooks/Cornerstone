"""
services/pipeline_run_results — Staging table CRUD and commit logic.

Submodules:
  repo    — CRUD for pipeline_run_results and pipeline_run_flag_results.
  commit  — Commit transaction: stage → draft tables + threshold write.
"""
