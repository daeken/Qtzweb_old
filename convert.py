import sys
from biplist import readPlist
from pprint import pprint
from yaml import load

def pruneUserInfo(data):
  if isinstance(data, list):
    map(pruneUserInfo, data)
  elif isinstance(data, dict):
    if 'userInfo' in data:
      del data['userInfo']
    map(pruneUserInfo, data.values())

def fix(name):
  if name.startswith('input') and len(name) > 5:
    name = name[5:]
  elif name.startswith('output') and len(name) > 6:
    name = name[6:]
  if name[0] in '0123456789':
    return '_' + name
  return name

def dump(plist):
  #pprint(plist)
  def dumpNode(obj, tab=0):
    def line(x, i=0):
      print '  ' * (tab+i) + x

    line('patch:')
    if 'connections' in obj['state']:
      connections = obj['state']['connections'].values()
    else:
      connections = []
    nodes = obj['state']['nodes']

    anodes = {}
    for node in nodes:
      snode = None
      if 'nodes' in node['state']:
        snode = node
      anodes[node['key']] = (node['class'], node['identifier'] if 'identifier' in node else None, [], [], snode)
      state = node['state']
      if 'customInputPortStates' in state:
        for name in state['customInputPortStates']:
          name = fix(name)
          if name not in anodes[node['key']][2]:
            anodes[node['key']][2].append(name)
      if 'ivarInputPortStates' in state:
        for name in state['ivarInputPortStates']:
          name = fix(name)
          if name not in anodes[node['key']][2]:
            anodes[node['key']][2].append(name)

    for conn in connections:
      dest = fix(conn['destinationPort'])
      if dest not in anodes[conn['destinationNode']][2]:
        anodes[conn['destinationNode']][2].append(dest)
      src = fix(conn['sourcePort'])
      if src not in anodes[conn['sourceNode']][3]:
        anodes[conn['sourceNode']][3].append(src)

    for name, (cls, format, inp, out, snode) in anodes.items():
      line('%s(%s%s):' % (name, cls, '.' + format if format else ''), 1)
      if inp:
        line('in:', 2)
        for elem in inp:
          line('- %s' % elem, 3)
      if out:
        line('out:', 2)
        for elem in out:
          line('- %s' % elem, 3)
      if snode:
        dumpNode(snode, tab+2)

  dumpNode(plist['rootPatch'])
  print

class Node(object):
  _inports = ''
  _outports = ''

  def __init__(self):
    self.format = None
    self.cls = self.__class__.__name__
    self.outports = {}
    for port in self._outports:
      port = fix(str(port))
      if port not in self.outports:
        self.outports[port] = OutPort(self, port)

    self.inports = {}
    for port in self._inports:
      port = fix(str(port))
      if port not in self.inports:
        self.inports[port] = None

  def outport(self, name):
    return self.outports[fix(name)].ref()

  def inport(self, name, value):
    self.inports[fix(name)] = value

class OutPort(object):
  def __init__(self, srcnode, srcport):
    self.srcnode, self.srcport = srcnode, srcport
    self.refs = 0

  def ref(self):
    self.refs += 1
    return self

class QCPatch(Node):
  def __init__(self, patch):
    self.name = 'rootPatch' # XXX: Need to know how to pull names out of subpatches
    self.nodes = {}
    deps = {}
    state = patch['state']
    for elem in state['nodes']:
      try:
        if not elem['systemInputPortStates']['_enable']['value']:
          continue
      except:
        pass

      try:
        node = globals()[elem['class']]()
      except:
        print 'No class', elem['class']
        sys.exit()
      node.name = elem['key']
      if 'identifier' in elem:
        node.format = elem['identifier']
      estate = elem['state']

      if 'customInputPortStates' in estate:
        for k, v in estate['customInputPortStates'].items():
          if 'value' in v:
            node.inport(k, v['value'])
      if 'ivarInputPortStates' in estate:
        for k, v in estate['ivarInputPortStates'].items():
          node.inport(k, v['value'])

      self.nodes[elem['key']] = node
      deps[elem['key']] = []

    for v in state['connections'].values():
      source = v['sourceNode'], v['sourcePort']
      dest = v['destinationNode'], v['destinationPort']
      sport = self.nodes[source[0]].outport(source[1])
      self.nodes[dest[0]].inport(dest[1], sport)
      if source[0] not in deps[dest[0]]:
        deps[dest[0]].append(source[0])

    # XXX: Have to have a way to specify ordering of nodes ... Clear should be first.
    self.order = []
    while len(deps):
      for name, v in deps.items():
        for dep in v:
          if dep not in deps:
            v.remove(dep)
        if not len(v):
          self.order.append(name)
          del deps[name]

  def code(self):
    code = '%s = new QCPatch();\n' % self.name
    for name in self.order:
      node = self.nodes[name]
      args = []
      if node.format:
        args.append('_format: ' + repr(node.format))
      for pname, value in node.inports.items():
        if not isinstance(value, OutPort):
          args.append('%s: %r' % (pname, value))
      args = ', '.join(args)
      code += '%s.nodes.%s = new %s({%s});\n' % (self.name, name, node.cls, args)
    code += '%s.update(function() {\n' % self.name
    for name in self.order:
      node = self.nodes[name]
      for pname, value in node.inports.items():
        if isinstance(value, OutPort):
          code += '\tthis.nodes.%s.params.%s = this.nodes.%s.outs.%s;\n' % (name, pname, value.srcnode.name, value.srcport)
      code += '\tthis.nodes.%s.update();\n' % name
    code += '});\n'
    code += 'run(%s);' % self.name
    return code

classes = load(file('classes.yaml').read())

for name, elem in classes.items():
  body = dict()
  if 'in' in elem:
    body['_inports'] = elem['in']
  if 'out' in elem:
    body['_outports'] = elem['out']
  globals()['QC' + name] = type('QC' + name, (Node, ), body)

def main(fn):
  data = readPlist(fn)
  del data['templateImageData']
  pruneUserInfo(data)

  print '<pre>'
  dump(data)
  print '</pre>'

  root = QCPatch(data['rootPatch'])
  print '<script src="qc.js"></script>'
  print '<script>'
  print root.code()
  print '</script>'

if __name__=='__main__':
  sys.exit(main(*sys.argv[1:]))
