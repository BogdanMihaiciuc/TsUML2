import * as SimpleAST from "ts-morph";
import { PropertyDetails, MethodDetails, HeritageClause, HeritageClauseType, Interface, Clazz, Enum, TypeAlias } from "../model";

export function getAst(tsConfigPath: string, sourceFilesPathsGlob?: string) {
    const ast = new SimpleAST.Project({
        tsConfigFilePath: tsConfigPath,
        skipAddingFilesFromTsConfig: !!sourceFilesPathsGlob
    });
    if (sourceFilesPathsGlob) {
        ast.addSourceFilesAtPaths(sourceFilesPathsGlob);
    }
    return ast;
}

export function parseClasses(classDeclaration: SimpleAST.ClassDeclaration) {
    
    const className = getClassOrInterfaceName(classDeclaration) || "undefined";
    const propertyDeclarations = classDeclaration.getProperties();
    const methodDeclarations = classDeclaration.getMethods();
    const ctors = classDeclaration.getConstructors();

    let id = classDeclaration.getSymbol()?.getFullyQualifiedName() ?? "";
    if (!id.length) {
        console.error("missing class id");
    }

    let properties = propertyDeclarations.map(parseProperty).filter((p) => p !== undefined) as PropertyDetails[];

    if (ctors && ctors.length) {
        //find the properties declared by using a modifier before a constructor paramter
        const ctorProperties =
            ctors[0].getParameters().map(param => {
                if(!param.getModifiers().length) {
                    return undefined; 
                }
                return parseProperty(param);
            }).filter(p => p !== undefined) as PropertyDetails[];
        properties.push(...ctorProperties);
    }

    const methods = methodDeclarations.map(parseMethod).filter((p) => p !== undefined) as MethodDetails[];

    return new Clazz({ name: className, properties, methods, id, heritageClauses: parseClassHeritageClauses(classDeclaration) });
}

export function parseInterfaces(interfaceDeclaration: SimpleAST.InterfaceDeclaration) {

    const interfaceName = getClassOrInterfaceName(interfaceDeclaration) || 'undefined';
    const propertyDeclarations = interfaceDeclaration.getProperties();
    const methodDeclarations = interfaceDeclaration.getMethods();

    let id = interfaceDeclaration.getSymbol()?.getFullyQualifiedName() ?? "";
    if (!id.length) {
        console.error("missing interface id");
    }


    const properties = propertyDeclarations.map(parseProperty).filter((p) => p !== undefined) as PropertyDetails[];
    const methods = methodDeclarations.map(parseMethod).filter((p) => p !== undefined) as MethodDetails[];
  
    return new Interface({ name: interfaceName, properties, methods, id, heritageClauses: parseInterfaceHeritageClauses(interfaceDeclaration) });
}

export function parseTypes(typeDeclaration: SimpleAST.TypeAliasDeclaration) {

    const name = getClassOrInterfaceName(typeDeclaration) || 'undefined';
    const t = typeDeclaration.getType();
    const typeNode = typeDeclaration.getTypeNode();

    let propertyDeclarations: SimpleAST.PropertySignature[] = [];
    let methodDeclarations: SimpleAST.MethodSignature[] = [];

    if(typeNode instanceof SimpleAST.TypeLiteralNode) {
        propertyDeclarations = typeNode.getProperties();
        methodDeclarations = typeNode.getMethods();
    } else {
        // no structured type --> lets skip that (for now)
        return; 
    }
    
  

    let id = typeDeclaration.getSymbol()?.getFullyQualifiedName() ?? "";
    if (!id.length) {
        console.error("missing type id");
    }

    const properties = propertyDeclarations.map(parseProperty).filter((p) => p !== undefined) as PropertyDetails[];
    const methods = methodDeclarations.map(parseMethod).filter((p) => p !== undefined) as MethodDetails[];


    return new TypeAlias({ name, id, methods, properties });
    
}


function parseProperty(propertyDeclaration: SimpleAST.PropertyDeclaration | SimpleAST.PropertySignature | SimpleAST.ParameterDeclaration) : PropertyDetails | undefined {
    const sym = propertyDeclaration.getSymbol();
    
    if (sym) {
        return {            
            modifierFlags: propertyDeclaration.getCombinedModifierFlags(),
            name: sym.getName(),
            type: getPropertyTypeName(sym),
            typeIds: getTypeIdsFromSymbol(sym)
        }
    }

}

function parseMethod(methodDeclaration: SimpleAST.MethodDeclaration | SimpleAST.MethodSignature) : MethodDetails | undefined{
    const sym = methodDeclaration.getSymbol();
    if (sym) {
        const returnSymbol = methodDeclaration.getReturnType().getSymbol();
        let argumentIds: {name: string, ids: string[], type?: string}[] | undefined;

        const argumentSymbols = methodDeclaration.getParameters()
            .map(p => ({param: p, type: p.getType(), symbol: p.getType()?.getSymbol()}))
            .filter(s => !!s.symbol)
            .reduce((acc, val) => {
                acc.push({name: val.param!.getName(), ids: getTypeIdsFromSymbol(val.symbol!), type: getTypeAsString(val.type)});
                return acc;
            }, [] as {name: string, ids: string[], type?: string}[]);

        if (argumentSymbols.length) {
            argumentIds = argumentSymbols;
        }

        return {
            modifierFlags: methodDeclaration.getCombinedModifierFlags(),
            name: sym.getName(),
            returnType: getMethodTypeName(methodDeclaration),
            returnTypeIds: returnSymbol && getTypeIdsFromSymbol(returnSymbol),
            arguments: getMethodArguments(methodDeclaration),
            argumentIds
        }
    }
}

export function parseEnum(enumDeclaration: SimpleAST.EnumDeclaration) {
    const enumName = enumDeclaration.getSymbol()!.getName();

    let id = enumDeclaration.getSymbol()?.getFullyQualifiedName() ?? "";
    if (!id.length) {
        console.error("missing class id");
    }

    let enumItems: string[] = []

    enumDeclaration.getMembers().forEach(mem => enumItems.push(mem.getName()))

    return new Enum({ name: enumName, id, enumItems });
}

export function parseClassHeritageClauses(classDeclaration: SimpleAST.ClassDeclaration ) {

    const className = getClassOrInterfaceName(classDeclaration);
    const classTypeId = classDeclaration.getSymbol()?.getFullyQualifiedName() ?? "";
    const baseClass =  classDeclaration.getBaseClass();
    const interfaces = classDeclaration.getImplements();
    const mixins = classDeclaration.getBaseTypes();
 
    
    let heritageClauses: HeritageClause[] = [];

    if(!className) {
        return heritageClauses;
    }

    if (className && baseClass) {
        const baseClassName = getClassOrInterfaceName(baseClass);
        if(baseClassName) {
            heritageClauses.push({
                        clause: baseClassName,
                        clauseTypeId: baseClass.getSymbol()?.getFullyQualifiedName()!,
                        className,
                        classTypeId,
                        type: HeritageClauseType.Extends
            });
        }
    }
    else if (className && mixins.length) {
        // Support mixins
        for (const mixin of mixins) {
            heritageClauses.push({
                clause: getTypeAsString(mixin) || '',
                clauseTypeId: mixin.getSymbol()?.getFullyQualifiedName()!,
                className,
                classTypeId,
                type: HeritageClauseType.Extends
            })
        }
    }

    // the implemented interfaces
    interfaces.forEach(interf => {
       let ifName: string| undefined;
       const type = interf.getType();
       const targetType =  type.getTargetType();
        if (interf && (ifName = getClassOrInterfaceName(targetType || type))) {

            heritageClauses.push(
                {
                    clause: ifName,
                    clauseTypeId: getTypeIdsFromType(interf.getType())?.[0]!,
                    className,
                    classTypeId,
                    type: HeritageClauseType.Implements
                }
            );
        }
    })

    return heritageClauses;
}

export function parseInterfaceHeritageClauses(interfaceDeclaration: SimpleAST.InterfaceDeclaration) {

    const ifName = getClassOrInterfaceName(interfaceDeclaration);
    const classTypeId = interfaceDeclaration.getSymbol()?.getFullyQualifiedName() ?? "";
    const baseDeclarations =  interfaceDeclaration.getBaseDeclarations();

    let heritageClauses: HeritageClause[] = [];

    if(!ifName) {
        return heritageClauses;
    }

    if (baseDeclarations) {
        baseDeclarations.forEach(bd => {
            const bdName = getClassOrInterfaceName(bd);
            if (bdName) {
                heritageClauses.push(
                    {
                        clause: bdName,
                        clauseTypeId: getTypeIdsFromType(bd.getType())?.[0]!,
                        className: ifName,
                        classTypeId,
                        type: HeritageClauseType.Implements
                    }
                );
            }
        });
    }

    return heritageClauses;
}


// utility functions

function getPropertyTypeName(propertySymbol: SimpleAST.Symbol) {
    const t = propertySymbol.getValueDeclaration()?.getType();
    if (!t) {
        return undefined;
    }
    return getTypeAsString(t);
}

function getMethodTypeName(method: SimpleAST.MethodSignature | SimpleAST.MethodDeclaration) {
    return getTypeAsString(method.getReturnType());
}

function getMethodArguments(method: SimpleAST.MethodSignature | SimpleAST.MethodDeclaration) {
    const args = method.getParameters();
    return args.map(arg => getTypeAsString(arg.getType())).filter(arg => !!arg) as string[];
}

function getTypeAsString(type?: SimpleAST.Type<SimpleAST.ts.Type>): string | undefined {
    if(!type) {
        return undefined;
    }

    let name;
    if( type.isArray()) {
        const typeArgs = type.getTypeArguments();
        if(typeArgs.length > 0) {
            let elType = type.getTypeArguments()[0];
            name = getTypeAsString(elType);
        }
        
        if(name) {
            return name + "[]"
        }
        return "[]"
        
    } else {
        // might be a combination of types  MyType | undefined
        // getText and remove the import("abc.def.ts"). parts
        name = type?.getText();
        name = name.replace(/import\([\d\D]*?\)\./g,'');
    }

    return name;
}

/**
 * return an array of type ids (array because of union / intersection)
 * @param symbol returns undefined if simple type number ...
 */
function getTypeIdsFromSymbol(symbol: SimpleAST.Symbol) : string[] {
   
    let valueDecl = symbol.getValueDeclaration();
    if (!valueDecl) {
        return [];
    }
    let type = valueDecl.getType();
    return getTypeIdsFromType(type);

}

function getTypeIdsFromType(t?: SimpleAST.Type<SimpleAST.ts.Type>): string[] {
    if (!t) {
        return [];
    }

    let ids: (string|undefined)[] = [];

    if(t.isClassOrInterface()) {
        ids.push(t.getSymbol()?.getFullyQualifiedName());
    } else if (t.isEnum()) {
        ids.push(t.getSymbol()?.getFullyQualifiedName());    
    } else if (t.isUnionOrIntersection()) {
        ids = [...(t.getUnionTypes()), ...(t.getIntersectionTypes())].map(getTypeIdsFromType).flat();
       // throw new Error("not implemented");
    } else if (t.isArray()) {
        return getTypeIdsFromType(t.getTypeArguments()[0]);
       // throw new Error("not implemented");
    } else if (t.isAnonymous()) {
        // an anonymous type
        ids.push(t.getAliasSymbol()?.getFullyQualifiedName());
    } else if (t.isTypeParameter()) {
        return [];
        // throw new Error("not implemented");
    } else {
        if((t as any).getSymbol) {
            ids.push((t as SimpleAST.Type<SimpleAST.ts.Type>).getSymbol()?.getFullyQualifiedName());
        }
    }

    return ids.filter(id => id !== undefined) as string[] ;
}

function getClassOrInterfaceName(classOrIf: SimpleAST.ClassDeclaration | SimpleAST.InterfaceDeclaration | SimpleAST.TypeAliasDeclaration | SimpleAST.ExpressionWithTypeArguments | SimpleAST.Type ) {
    try {
        let name: string;
        let generics: string[] = [];
        if (classOrIf instanceof SimpleAST.ExpressionWithTypeArguments) {
            return classOrIf.getText();
        }

        if (classOrIf instanceof SimpleAST.Type) {
            name = classOrIf.getSymbol()!.getName();
            if(name === "__type") {
                name = classOrIf.getAliasSymbol()!.getName();
            }
            generics = classOrIf.getTypeArguments().map(arg => arg.getSymbol()!.getName());
        } else {
            //interface or class declaration or TypeAliasDeclaration
            if(!classOrIf.getTypeParameters) {
                return undefined; // some weird thing with mapped types i.e: Partial (TODO: investigate this further)
            }
            name = classOrIf.getSymbol()!.getName();
            generics= classOrIf.getTypeParameters().map((param) => param.getName()); 
        }
        
    
        
        if (generics && generics.length) {
            name += "<" + generics.join(",") + ">";
        }

        return name;
    } catch(err) {
        console.log(err);
        return undefined;
    }
}

