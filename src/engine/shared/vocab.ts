// ============================================================================
// Muten lexical & grammar vocabulary
// ============================================================================
// The single, typed source for every string the parser matches or builds. No
// magic strings anywhere downstream: token kinds, punctuation, keywords, node
// types, operators, statement ops and modifiers all have a NAME here.
//
// String enums (their members are assignable to `string`, so they double as the
// `v` argument of at()/eat() and compare cleanly against scanned identifiers).
// ============================================================================

/** Token kinds the lexer emits. */
export enum Tk {
  Ident = 'ident',
  String = 'string',
  Number = 'number',
  Ref = 'ref',           // @state
  Param = 'param',       // $partParam
  Punct = 'punct',       // single char (see Pn)
  Arrow = 'arrow',       // ->
  LArrow = 'larrow',     // <-
  Eq = 'eq',             // ==
  Neq = 'neq',           // !=
  Lte = 'lte',           // <=
  Gte = 'gte',           // >=
  FatArrow = 'fatarrow', // =>
  Eof = 'eof',
}

/** Single-character punctuation — the `v` of a Punct token. */
export enum Pn {
  BraceL = '{', BraceR = '}',
  ParenL = '(', ParenR = ')',
  BrackL = '[', BrackR = ']',
  Comma = ',', Pipe = '|', Colon = ':', Assign = '=',
  Lt = '<', Gt = '>', Dot = '.', Slash = '/',
  Plus = '+', Star = '*', Question = '?', Dash = '-',
}

/** Keywords and reserved idents the parser matches. */
export enum Kw {
  Screen = 'screen', Entity = 'entity', State = 'state', Store = 'store',
  Get = 'get', Effect = 'effect', Action = 'action', Mutates = 'mutates',
  Mock = 'mock', Sources = 'sources', Routes = 'routes', Shell = 'shell',
  Part = 'part', Const = 'const', Theme = 'theme', Query = 'query', Param = 'param', Api = 'api', Body = 'body', Meta = 'meta',
  Use = 'use', From = 'from', Client = 'client',
  When = 'when', Each = 'each', As = 'as', If = 'if', Else = 'else',
  Guard = 'guard', Not = 'not', And = 'and', Or = 'or', Contains = 'contains',
  Required = 'required', Min = 'min', Max = 'max',
  True = 'true', False = 'false', Null = 'null',
}

/** Primitive / node type names (the full vocabulary the parser builds and the compiler emits). */
export enum Nt {
  // containers (semantic landmarks + layout)
  Shell = 'Shell', Header = 'Header', Nav = 'Nav', Sidebar = 'Sidebar', Footer = 'Footer', Page = 'Page', Stack = 'Stack',
  // content
  Text = 'Text', Title = 'Title', Span = 'Span', Image = 'Image',
  // interactive
  Link = 'Link', Button = 'Button', Form = 'Form', SearchField = 'SearchField',
  DataTable = 'DataTable', RowAction = 'RowAction', Custom = 'Custom',
  // control flow + outlet
  When = 'When', Each = 'Each', Slot = 'slot',
}

/** Compile output format. */
export enum Fmt { Module = 'module', Store = 'store', Html = 'html', Ssr = 'ssr' }

/** Editable form-field kinds (how a Form renders an entity field). */
export enum Fk { Text = 'text', Email = 'email', Enum = 'enum' }

/** Binary operators (in the expression AST). */
export enum BOp {
  Or = 'or', And = 'and',
  Eq = '==', Neq = '!=', Lte = '<=', Gte = '>=', Lt = '<', Gt = '>', Contains = 'contains',
  Add = '+', Sub = '-', Mul = '*', Div = '/',
}
/** Unary operators. */
export enum UOp { Not = 'not' }

/** Expression AST node kinds (discriminants). */
export enum Ek { Lit = 'lit', Ref = 'ref', Un = 'un', Bin = 'bin', Tern = 'tern', Interp = 'interp', Call = 'call' }

/** Action-body statement ops (discriminants) — mutations + the `if` branch. */
export enum StOp { Push = 'push', Set = 'set', Reset = 'reset', Remove = 'remove', Create = 'create', Update = 'update', Delete = 'delete', Refetch = 'refetch', Request = 'request', If = 'if' }

/** Node modifiers (post-primitive). */
export enum Mod {
  Bind = 'bind', Submit = 'submit', Where = 'where', Columns = 'columns',
  Style = 'style', Class = 'class', Alt = 'alt', Inputs = 'inputs', On = 'on',
}
