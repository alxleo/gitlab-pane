import fc from 'fast-check'

// Property tests run on a fixed seed so CI is repeatable. fast-check prints the seed and the path of any counterexample,
// and `fc.assert(..., { seed, path })` replays it.
fc.configureGlobal({ seed: 20260505, numRuns: 200 })
