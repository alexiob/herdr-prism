/** porcelain-v2 -z uses NUL records; rename records include an extra source path. */
export function parseStatus(text) {
    const result = { branchState: 'unknown', changedFiles: 0, untrackedFiles: 0, conflicts: 0, stagedFiles: 0, unstagedFiles: 0 };
    const records = text.split('\0');
    for (let i = 0; i < records.length; i++) {
        const record = records[i];
        if (record.startsWith('# branch.oid ')) {
            const oid = record.slice(13);
            if (oid === '(initial)')
                result.branchState = 'unborn';
            else
                result.head = oid;
        }
        else if (record.startsWith('# branch.head ')) {
            const branch = record.slice(14);
            if (branch === '(detached)')
                result.branchState = 'detached';
            else {
                result.branch = branch;
                if (result.branchState !== 'unborn')
                    result.branchState = 'named';
            }
        }
        else if (record.startsWith('# branch.upstream '))
            result.upstream = record.slice(18);
        else if (record.startsWith('# branch.ab ')) {
            const match = /^# branch.ab \+(\d+) -(\d+)$/.exec(record);
            if (match) {
                result.ahead = Number(match[1]);
                result.behind = Number(match[2]);
            }
        }
        else if (record.startsWith('? '))
            result.untrackedFiles++;
        else if (/^[12u] /.test(record)) {
            const xy = record.slice(2, 4);
            result.changedFiles++;
            if (record[0] === 'u')
                result.conflicts++;
            if (xy[0] !== '.')
                result.stagedFiles++;
            if (xy[1] !== '.')
                result.unstagedFiles++;
            if (record[0] === '2')
                i++;
        }
    }
    return result;
}
export function parseNumstat(text) {
    let added = 0, deleted = 0, binaryFiles = 0;
    const records = text.split('\0');
    for (let i = 0; i < records.length; i++) {
        const record = records[i];
        if (!record)
            continue;
        const first = record.indexOf('\t'), second = record.indexOf('\t', first + 1);
        if (first < 0 || second < 0)
            throw new Error('Malformed Git numstat');
        const a = record.slice(0, first), d = record.slice(first + 1, second);
        if (a === '-' && d === '-')
            binaryFiles++;
        else if (/^\d+$/.test(a) && /^\d+$/.test(d)) {
            added += Number(a);
            deleted += Number(d);
        }
        else
            throw new Error('Malformed Git numstat counts');
        if (record.slice(second + 1) === '')
            i += 2;
    }
    if (!Number.isSafeInteger(added) || !Number.isSafeInteger(deleted))
        throw new Error('Git line totals exceed safe range');
    return { added, deleted, binaryFiles };
}
