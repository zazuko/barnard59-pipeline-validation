const { describe, it } = require('mocha')
const assert = require('assert')
const path = require('path')
const sinon = require('sinon')
const iriResolve = require('rdf-loader-code/lib/iriResolve')
const proxyquire = require('proxyquire')
const parser = require('../lib/parser')
const Issue = require('../lib/issue')
const { turtleToCF } = require('./helpers')

const mock = {}
const mockedParser = proxyquire('../lib/parser', {
  './utils': mock
})
class ClownfaceMock {
  namedNode () {
    return null
  }

  has () {
    return null
  }

  in () {
    return null
  }

  out () {
    return null
  }

  list () {
    return null
  }
}

function generateGraphMock () {
  const pizzaSteps = sinon.createStubInstance(ClownfaceMock, {
    out: sinon.stub().returnsThis()
  })
  pizzaSteps.term = { value: null }
  const steps = [
    'operation1',
    'Turn on the oven',
    'operation2',
    'Put there frozen pizza',
    'operation3',
    'Wait 30 min',
    'operation4',
    'Enjoy!'
  ]
  sinon.stub(pizzaSteps, 'term').get(function getterFn () {
    return { value: steps.shift() }
  })

  const pancakeSteps = sinon.createStubInstance(ClownfaceMock, {
    out: sinon.stub().returnsThis()
  })
  pancakeSteps.term = { value: null }
  const steps2 = [
    'operation1',
    'Find a French chef',
    'operation2',
    'Ask them to make you pancakes'
  ]
  sinon.stub(pancakeSteps, 'term').get(function getterFn () {
    return { value: steps2.shift() }
  })

  const pancakesPipeline = sinon.createStubInstance(ClownfaceMock, {
    out: sinon.stub().returnsThis(),
    list: [pancakeSteps, pancakeSteps]
  })
  pancakesPipeline.term = { value: 'pancakes' }

  const pizzaPipeline = sinon.createStubInstance(ClownfaceMock, {
    out: sinon.stub().returnsThis(),
    list: [pizzaSteps, pizzaSteps, pizzaSteps, pizzaSteps]
  })
  pizzaPipeline.term = { value: 'pizza' }

  const graph = sinon.createStubInstance(ClownfaceMock, {
    has: [pizzaPipeline, pancakesPipeline]
  })
  return graph
}

describe('parser.getDependencies', () => {
  it('should create tree structure for codelinks', () => {
    const input = [
      { stepName: 'a', stepOperation: 'node:barnard59-base#fetch.json' },
      { stepName: 'b', stepOperation: 'node:barnard59-base#map' },
      { stepName: 'c', stepOperation: 'node:barnard59-formats#ntriples.serialize' },
      { stepName: 'd', stepOperation: 'file:awesomeModule#awesomeFunction' }
    ]
    const expected = {
      'node:': {
        'barnard59-base': new Set(['node:barnard59-base#fetch.json', 'node:barnard59-base#map']),
        'barnard59-formats': new Set(['node:barnard59-formats#ntriples.serialize'])
      },
      'file:': {
        [path.join(process.cwd(), 'awesomeModule')]: new Set(['file:awesomeModule#awesomeFunction'])
      }
    }
    const actual = parser.getDependencies(input)
    assert.deepStrictEqual(expected, actual)
  })

  it('should fail with noniterable input', () => {
    const input = 'node:barnard59-base#fetch.json'
    assert.throws(() => parser.getDependencies(input), TypeError)
  })

  it('should forward iriResolve error', () => {
    const input = [{ stepOperation: 'abc' }]
    try {
      iriResolve(input[0].stepOperation, process.cwd())
      assert.fail('The input is invalid')
    }
    catch (expectedError) {
      assert.throws(() => parser.getDependencies(input), expectedError)
    }
  })
})

describe('parser.getAllCodeLinks', () => {
  it('should transform dict values to set', () => {
    const input = {
      pancakes: ['flour', 'eggs', 'milk', 'olive oil'],
      brioche: ['flour', 'milk', 'butter', 'yeast']
    }
    const expected = new Set(['flour', 'eggs', 'milk', 'olive oil', 'butter', 'yeast'])
    const actual = parser.getAllCodeLinks(input)
    assert.deepStrictEqual(expected, actual)
  })
})

describe('parser.readGraph', () => {
  it('should read .ttl file and create DatasetCore object', async () => {
    const input = path.join(__dirname, 'fixtures/example.ttl')
    const graph = await parser.readGraph(input)

    assert.strictEqual(graph.dataset.size, 4)
  })
})

describe('parser.getModuleOperationProperties', () => {
  // Mock input properties
  const ids = ['Christian Andersen', 'Johnny Bravo', 'Pikachu']
  const andersenNodes = [{
    term: {
      value: 'prefix/writer'
    }
  },
  {
    term: {
      value: 'prefix/Dannish'
    }
  }]
  const bravoNodes = [{
    term: {
      value: 'prefix/narcissist'
    }
  },
  {
    term: {
      value: 'prefix/womanizer'
    }
  }]
  const picachuNodes = []

  const graph = sinon.createStubInstance(ClownfaceMock, {
    namedNode: sinon.stub().returnsThis(),
    in: sinon.stub().returnsThis()
  })

  graph.out.onCall(0).returns(andersenNodes)
  graph.out.onCall(1).returns(bravoNodes)
  graph.out.onCall(2).returns(picachuNodes)

  it('should create properties tree for identifiers', () => {
    const actual = parser.getModuleOperationProperties(graph, ids)
    const expected = {
      'Christian Andersen': ['writer', 'Dannish'],
      'Johnny Bravo': ['narcissist', 'womanizer'],
      Pikachu: null
    }
    assert.deepStrictEqual(actual, expected)
  })
})

describe('parser.getIdentifiers', () => {
  it('should create pipelines list', () => {
    const input = generateGraphMock()
    const expected = {
      pizza: [
        { stepName: 'Turn on the oven', stepOperation: 'operation1' },
        { stepName: 'Put there frozen pizza', stepOperation: 'operation2' },
        { stepName: 'Wait 30 min', stepOperation: 'operation3' },
        { stepName: 'Enjoy!', stepOperation: 'operation4' }
      ],
      pancakes: [
        { stepName: 'Find a French chef', stepOperation: 'operation1' },
        { stepName: 'Ask them to make you pancakes', stepOperation: 'operation2' }
      ]
    }

    const actual = parser.getIdentifiers(input, [])
    assert.deepStrictEqual(actual, expected)
  })

  it('should return only requested pipeline', () => {
    const input = generateGraphMock()
    const expected = {
      pancakes: [
        { stepName: 'Find a French chef', stepOperation: 'operation1' },
        { stepName: 'Ask them to make you pancakes', stepOperation: 'operation2' }
      ]
    }
    const actual = parser.getIdentifiers(input, [], 'pancakes')
    assert.deepStrictEqual(actual, expected)
  })

  it('should return empty dict if pipeline does not exist', () => {
    const input = generateGraphMock()
    const expected = {}
    const actual = parser.getIdentifiers(input, [], 'inexistentPipeline')
    assert.deepStrictEqual(actual, expected)
  })

  it('should not crash on invalid steps', async () => {
    const input = await turtleToCF(`
      @prefix p: <https://pipeline.described.at/> .

      <mainCreateFile> a p:Pipeline, p:Readable;
        p:variables _:vars ;
        p:steps [
          p:stepList (<mainUpload>)
        ].

      <mainUpload> a p:Pipeline;
        p:variables _:vars ;
        p:steps [].
    `)

    const errors = []
    const expected = {
      mainCreateFile: [],
      mainUpload: []
    }
    const actual = parser.getIdentifiers(input, errors)
    assert.deepStrictEqual(actual, expected)
    assert.strictEqual(errors.length, 1)
    const error = errors[0]
    assert.strictEqual(error.level, 'error')
    assert.strictEqual(error.message, 'Missing code.implementedBy/code.link')
    assert.strictEqual(error.step, 'mainUpload')
  })
})

describe('parser.getAllOperationProperties', () => {
  const mock = {}
  const mockedParser = proxyquire('../lib/parser', {
    './utils': mock
  })

  it('should get operation properties from operations.ttl file', async () => {
    mock.removeFilePart = sinon.stub().returns('test/fixtures')

    const input = {
      'node:': {
        // name of any installed module
        sinon: new Set(['node:party-module#dance', 'node:party-module#drink'])
      }
    }
    const expected = {
      'node:party-module#dance': null,
      'node:party-module#drink': ['Operation', 'Writable', 'Readable']
    }

    const actual = await mockedParser.getAllOperationProperties(input)
    assert.deepStrictEqual(actual, expected)
  })

  it("should return nulls if operation.ttl doesn't exist", async () => {
    mock.removeFilePart = sinon.stub().returns('inexistent-folder')

    const input = {
      'node:': {
        sinon: new Set(['node:party-module#dance', 'node:party-module#drink']),
        mocha: new Set(['node:work-module#code', 'node:work-module#sleep'])
      }
    }

    const expected = {
      'node:party-module#dance': null,
      'node:party-module#drink': null,
      'node:work-module#code': null,
      'node:work-module#sleep': null
    }

    const actual = await mockedParser.getAllOperationProperties(input)
    assert.deepStrictEqual(actual, expected)
  })

  it('should return properties for existing operations, and nulls for nonexisting ones', async () => {
    mock.removeFilePart = sinon.stub().returns('test/fixtures')

    const input = {
      'node:': {
        sinon: new Set(['node:party-module#dance', 'node:party-module#drink']),
        mocha: new Set(['node:work-module#code', 'node:work-module#sleep'])
      }
    }

    const expected = {
      'node:party-module#dance': null,
      'node:party-module#drink': ['Operation', 'Writable', 'Readable'],
      'node:work-module#code': null,
      'node:work-module#sleep': null
    }

    const actual = await mockedParser.getAllOperationProperties(input)
    assert.deepStrictEqual(actual, expected)
  })

  it('should report missing packages', async () => {
    const errors = []
    const input = {
      'node:': {
        'foo-bar': new Set(['node:foo-bar#fn'])
      }
    }
    const expected = {}

    const actual = await mockedParser.getAllOperationProperties(input, errors)
    assert.deepStrictEqual(actual, expected)

    const issue = errors.find((issue) => issue.level === 'error')
    assert.ok(issue.message.includes('Missing package'))
    assert.ok(issue.message.includes('foo-bar'))
  })
})

describe('parser.getPipelineProperties', () => {
  const pipeline = {
    term: {
      value: null
    }
  }
  const pipelinesProperties = [
    'https://pipeline.described.at/Pipeline',
    'https://pipeline.described.at/Crunchy',
    'https://pipeline.described.at/Pipeline',
    'https://pipeline.described.at/Soft'

  ]
  sinon.stub(pipeline, 'term').get(function getterFn () {
    return { value: pipelinesProperties.shift() }
  })

  const graph = sinon.createStubInstance(ClownfaceMock, {
    namedNode: sinon.stub().returnsThis()
  })

  const pipelinesIDs = ['pizza', 'pancakes']
  it('should extract pipeline properties', () => {
    graph.out.onCall(0).returns([pipeline, pipeline])
    graph.out.onCall(1).returns([pipeline, pipeline])

    const actual = parser.getPipelineProperties(graph, pipelinesIDs)
    const expected = {
      pizza: ['Pipeline', 'Crunchy'],
      pancakes: ['Pipeline', 'Soft']
    }
    assert.deepStrictEqual(actual, expected)
  })
  it('should return null when no properties exist', () => {
    graph.out.onCall(2).returns([])
    graph.out.onCall(3).returns([])
    const actual = parser.getPipelineProperties(graph, pipelinesIDs)
    const expected = {
      pizza: null,
      pancakes: null
    }
    assert.deepStrictEqual(actual, expected)
  })
})

describe('parser.validatePipelines', () => {
  const pipelines = {
    pizza:
  [{ stepOperation: 'Turn on the oven' },
    { stepOperation: 'Put there frozen pizza' },
    { stepOperation: 'Wait 30 min' },
    { stepOperation: 'Enjoy!' }],
    pancakes:
  [{ stepOperation: 'Find a French chef' },
    { stepOperation: 'Ask them to make you pancakes' }]
  }
  const operation2properties = {
    'Find a French chef': ['quickly'],
    'Ask them to make you pancakes': null,
    'Turn on the oven': null,
    'Put there frozen pizza': null,
    'Wait 30 min': null,
    'Enjoy!': ['with friends']
  }
  const pizzaIssue = Issue.warning({
    message: 'Cannot validate pipeline pizza: the pipeline mode (readable(ObjectMode)/writable(ObjectMode)) is not defined'
  })
  const pancakesIssue = Issue.warning({
    message: 'Cannot validate pipeline pancakes: the pipeline mode (readable(ObjectMode)/writable(ObjectMode)) is not defined'
  })

  it('should issue a warning if pipeline has no readable/writable property', () => {
    const pipeline2properties = {
      pancakes: null,
      pizza: ['Pipeline', 'crunchy']
    }
    const expectedErrors = [['pizza', pizzaIssue], ['pancakes', pancakesIssue]]
    const actualErrors = []

    parser.validatePipelines(pipelines, operation2properties, pipeline2properties, actualErrors)
    assert.deepStrictEqual(actualErrors, expectedErrors)
  })
  it('should validate pipeline property if first/last operation property exists', () => {
    let actualErrors = []
    mock.validatePipelineProperty = sinon.stub().callsFake(() => actualErrors.push('it is burning!'))

    const pipeline2properties = {
      pancakes: ['soft', 'Readable'],
      pizza: ['crunchy', 'Writable']
    }
    const expectedErrors = ['it is burning!']

    for (const pipelineID of ['pizza', 'pancakes']) {
      actualErrors = []
      mockedParser.validatePipelines({ [pipelineID]: pipelines[pipelineID] }, operation2properties, pipeline2properties, actualErrors)
      assert.deepStrictEqual(actualErrors, expectedErrors)
    }
  })
  it("should do nothing it first/last operation property doesn't exist", () => {
    const actualErrors = []
    const expectedErrors = []

    operation2properties['Find a French chef'] = null
    operation2properties['with friends'] = null

    const pipeline2properties = {
      pancakes: ['soft', 'Readable'],
      pizza: ['crunchy', 'Readable']
    }
    parser.validatePipelines(pipelines, operation2properties, pipeline2properties, actualErrors)
    assert.deepStrictEqual(actualErrors, expectedErrors)
  })
})
