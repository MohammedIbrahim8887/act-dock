// Copy into the pinned Act checkout's pkg/model; this only benchmarks existing APIs.
package model

import (
	"strings"
	"testing"
)

const researchWorkflow = `name: research
on: workflow_dispatch
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo hello
  b:
    needs: a
    runs-on: ubuntu-latest
    steps:
      - run: true
`

func BenchmarkResearchReadWorkflow(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if _, err := ReadWorkflow(strings.NewReader(researchWorkflow), false); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkResearchPlan(b *testing.B) {
	planner, err := NewSingleWorkflowPlanner("research", strings.NewReader(researchWorkflow))
	if err != nil { b.Fatal(err) }
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := planner.PlanEvent("workflow_dispatch"); err != nil { b.Fatal(err) }
	}
}
