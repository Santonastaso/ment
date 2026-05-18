const { heuristicExtract } = require('../utils/profileExtractor');

describe('profileExtractor heuristic', () => {
  test('parses role and strengths from template text', () => {
    const text = `
Current role: Senior Engineer
Department: Engineering
Strengths:
- React
- system design
Areas for development:
- leadership
`;
    const out = heuristicExtract(text);
    expect(out.current_role).toMatch(/Senior Engineer/i);
    expect(out.department).toMatch(/Engineering/i);
    expect(out.strengths.map(s => s.toLowerCase())).toEqual(expect.arrayContaining(['react', 'system design']));
    expect(out.growth_areas.map(s => s.toLowerCase())).toEqual(expect.arrayContaining(['leadership']));
  });
});
