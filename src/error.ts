const bold = '\x1b[1m';
const endBold = '\x1b[0m';
const pink = '\x1b[35m';
const blue = '\x1b[34m';
const green = '\x1b[32m';
const orange = '\x1b[33m';
const newline = '\n';
const indent = '\t';

export function formatError(message: string, situation?: 'contract' | 'transaction' | 'peer-communication'): string {
    if (situation === 'contract') {
        return `${indent}${bold}${pink}${message}${endBold}`;
    }
    if (situation === 'transaction') {
        return `${bold}${blue}${message}${endBold}${newline}`;
    }
    if (situation === 'peer-communication') {
        return `${bold}${green}${message}${endBold}${newline}`;
    }

    return message;
}

export function formatLog(message: string, situation?: 'graphConstruction') : string {
    if (situation === 'graphConstruction') {
        return `${bold}${orange}${message}${endBold}`;
    }

    return message;
}