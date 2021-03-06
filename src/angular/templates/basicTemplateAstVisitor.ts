import * as ast from '@angular/compiler';
import * as ts from 'typescript';
import * as Lint from 'tslint';
import * as e from '@angular/compiler/src/expression_parser/ast';

import { ExpTypes } from '../expressionTypes';
import { ComponentMetadata } from '../metadata';
import { RecursiveAngularExpressionVisitor } from './recursiveAngularExpressionVisitor';
import {SourceMappingVisitor} from '../sourceMappingVisitor';


const getExpressionDisplacement = (binding: any) => {
  let attrLen = 0;
  let valLen = 0;
  let totalLength = 0;
  let result = 0;
  if (binding instanceof ast.BoundEventAst || binding instanceof ast.BoundElementPropertyAst) {
    // subBindingLen is for [class.foo], [style.foo], the length of
    // the binding type. For event it is 0. (+1 because of the ".")
    let subBindingLen = 0;
    if (binding instanceof ast.BoundElementPropertyAst) {
      let prop: ast.BoundElementPropertyAst = <ast.BoundElementPropertyAst>binding;
      // The length of the binding type
      switch (prop.type) {
        case ast.PropertyBindingType.Animation:
        subBindingLen = 'animate'.length + 1;
        break;
        case ast.PropertyBindingType.Attribute:
        subBindingLen = 'attr'.length + 1;
        break;
        case ast.PropertyBindingType.Class:
        subBindingLen = 'class'.length + 1;
        break;
        case ast.PropertyBindingType.Style:
        subBindingLen = 'style'.length + 1;
        break;
      }
    }
    // For [class.foo]=":
    // - Add the name of the binding (binding.name.length).
    // - 4 characters because of []=" (we already have the "." from above).
    // - subBindingLen is from above and applies only for elements.
    attrLen = binding.name.length + 4 + subBindingLen;
    // Total length of the attribute value
    if (binding instanceof ast.BoundEventAst) {
      valLen = binding.handler.span.end;
    } else {
      valLen = binding.value.span.end;
    }
    // Total length of the entire part of the template AST corresponding to this AST.
    totalLength = binding.sourceSpan.end.offset - binding.sourceSpan.start.offset;
    // The whitespace are possible only in:
    // `[foo.bar]          =         "...."`,
    // and they are verything except the attrLen and the valLen (-1 because of the close quote).
    let whitespace = totalLength - (attrLen + valLen) - 1;
    // The resulted displacement is the length of the attribute + the whitespaces which
    // can be located ONLY before the value (the binding).
    result = whitespace + attrLen + binding.sourceSpan.start.offset;
  } else if (binding instanceof ast.BoundTextAst) {
    result = binding.sourceSpan.start.offset;
  }
  return result;
};


export interface RecursiveAngularExpressionVisitorCtr {
  new(sourceFile: ts.SourceFile, options: Lint.IOptions, context: ComponentMetadata, basePosition: number);
}


export interface TemplateAstVisitorCtr {
  new(sourceFile: ts.SourceFile, options: Lint.IOptions, context: ComponentMetadata,
    templateStart: number, expressionVisitorCtrl: RecursiveAngularExpressionVisitorCtr);
}

export class BasicTemplateAstVisitor extends SourceMappingVisitor implements ast.TemplateAstVisitor {
  private _variables = [];

  constructor(sourceFile: ts.SourceFile,
    private _originalOptions: Lint.IOptions,
    protected context: ComponentMetadata,
    protected templateStart: number,
    private expressionVisitorCtrl: RecursiveAngularExpressionVisitorCtr = RecursiveAngularExpressionVisitor) {
      super(sourceFile, _originalOptions, context.template.template, templateStart);
    }

  protected visitNg2TemplateAST(ast: e.AST, templateStart: number) {
    const templateVisitor =
      new this.expressionVisitorCtrl(this.getSourceFile(), this._originalOptions, this.context, templateStart);
    templateVisitor.preDefinedVariables = this._variables;
    templateVisitor.visit(ast);
    templateVisitor.getFailures().forEach(f => this.addFailure(f));
  }

  visit?(node: ast.TemplateAst, context: any): any {
    node.visit(this, context);
  }

  visitNgContent(ast: ast.NgContentAst, context: any): any {}

  visitEmbeddedTemplate(ast: ast.EmbeddedTemplateAst, context: any): any {
    ast.variables.forEach(v => this.visit(v, context));
    ast.children.forEach(e => this.visit(e, context));
    ast.outputs.forEach(o => this.visit(o, context));
    ast.attrs.forEach(a => this.visit(a, context));
    ast.references.forEach(r => this.visit(r, context));
    ast.directives.forEach(d => this.visit(d, context));
  }

  visitElement(element: ast.ElementAst, context: any): any {
    const references = element.references.map(r => r.name);
    const oldVariables = this._variables;
    this._variables = this._variables.concat(references);
    element.references.forEach(r => this.visit(r, context));
    element.inputs.forEach(i => this.visit(i, context));
    element.outputs.forEach(o => this.visit(o, context));
    element.attrs.forEach(a => this.visit(a, context));
    element.children.forEach(e => this.visit(e, context));
    element.directives.forEach(d => this.visit(d, context));
    // Outside the scope of the element
    this._variables = oldVariables;
  }

  visitReference(ast: ast.ReferenceAst, context: any): any {
  }

  visitVariable(ast: ast.VariableAst, context: any): any {
    this._variables.push(ast.name);
  }

  visitEvent(ast: ast.BoundEventAst, context: any): any {
    if (this._variables.indexOf('$event') < 0) {
      this._variables.push('$event');
    }
    this.visitNg2TemplateAST(ast.handler,
        this.templateStart + getExpressionDisplacement(ast));
    this._variables.splice(this._variables.indexOf('$event'), 1);
  }

  visitElementProperty(prop: ast.BoundElementPropertyAst, context: any): any {
    const ast: any = (<e.ASTWithSource>prop.value).ast;
    ast.interpolateExpression = (<any>prop.value).source;
    this.visitNg2TemplateAST(prop.value, this.templateStart + getExpressionDisplacement(prop));
  }

  visitAttr(ast: ast.AttrAst, context: any): any {}

  visitBoundText(text: ast.BoundTextAst, context: any): any {
    if (ExpTypes.ASTWithSource(text.value)) {
      // Note that will not be reliable for different interpolation symbols
      const ast: any = (<e.ASTWithSource>text.value).ast;
      ast.interpolateExpression = (<any>text.value).source;
      this.visitNg2TemplateAST(ast,
          this.templateStart + getExpressionDisplacement(text));
    }
  }

  visitText(text: ast.TextAst, context: any): any {}

  visitDirective(ast: ast.DirectiveAst, context: any): any {}

  visitDirectiveProperty(ast: ast.BoundDirectivePropertyAst, context: any): any {}
}
