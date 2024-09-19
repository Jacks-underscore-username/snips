const fs = require('fs')
const path = require('path')
const chokidar = require('chokidar')
const { execSync } = require('child_process')
const { builtinModules } = require('module')
const os = require('os')

const snipTypes = ['folder', 'module', 'class', 'function', 'snip']

    ;
(async () => {

    //Make sure the shortcut exists
    if (((filePath, commandName) => {

        if (!fs.existsSync(filePath)) {
            console.log(`Error: The file at ${filePath} does not exist.`)
        }

        const osType = os.platform()

        if (osType === 'win32') {
            const windowsPath = process.env.USERPROFILE
            const batFilePath = path.join(windowsPath, `${commandName}.bat`)
            const batFileContent = `@echo off\nnode "${path.resolve(filePath)}" %*\n`

            if (fs.existsSync(batFilePath) && fs.readFileSync(batFilePath, 'utf8') === batFileContent)
                return false

            fs.writeFileSync(batFilePath, batFileContent)

            const setEnvCmd = `[System.Environment]::SetEnvironmentVariable('Path', $env:Path + ';${windowsPath}', [System.EnvironmentVariableTarget]::User)`

            execSync(`powershell -Command "${setEnvCmd}"`)
            execSync('powershell -Command "$env:Path = [System.Environment]::GetEnvironmentVariable(\'Path\', [System.EnvironmentVariableTarget]::User)"')
            return true
        }
        else if (['linux', 'android', 'darwin'].includes(osType)) {
            const shellConfigFile = path.join(os.homedir(), '.bashrc')
            const aliasCommand = `alias ${commandName}='node ${path.resolve(filePath)}'`

            const bashrcContent = fs.readFileSync(shellConfigFile, 'utf8')

            if (bashrcContent.split('\n').includes(aliasCommand))
                return false

            fs.appendFileSync(shellConfigFile, `\n# Added by script\n${aliasCommand}\n`)

            console.log(`Success! Added ${commandName} alias. Run 'source ~/.bashrc' or restart your terminal to apply the changes.`)
            return true
        } else
            console.log(`Unsupported OS: ${osType}`)
    })(path.join(__dirname, 'script.js'), 'snips')) {
        console.log('Shortcut added, you can now use `snips` anywhere.')
        process.exit(0)
    }

    //Make sure folder structure is correct.
    {
        if (!fs.existsSync(path.join(__dirname, 'data')))
            fs.mkdirSync(path.join(__dirname, 'data'))
        if (!fs.existsSync(path.join(__dirname, 'index.json')))
            fs.writeFileSync(path.join(__dirname, 'index.json'), '{}', 'utf8')
    }

    /**
     * Gets an input from the process.stdin.
     * @param {String} prompt A prompt given before every answer, eg "Enter name: "
     * @param {Function} checkFunc A function to check if an input is valid, 
     * is given the trimmed line as input, returns true | string | { pass:true, ?value:string, ?show:boolean },
     * if true is returned it passes,
     * if a string is returned it fails and logs the string,
     * if an object is returned it passes if obj.pass, and the line is overwritten with obj.value, which is shown if obj.show,
     * @returns
     */
    const getInput = (prompt, checkFunc = () => true) => new Promise(resolve => {
        process.stdout.write(prompt)
        let inCheckFunc = false
        const func = async line => {
            if (inCheckFunc) return
            line = line.toString().trim()
            inCheckFunc = true
            const result = await checkFunc(line)
            inCheckFunc = false
            if (result === true || (typeof result === 'object' && result.pass)) {
                process.stdin.off('data', func)
                if (typeof result === 'object') {
                    if (result.message !== undefined)
                        console.log(result.message)
                    if (result.value !== undefined) {
                        if (result.show)
                            process.stdout.write(`\x1b[F\x1b[2K${prompt}${result.value}\n`)
                        resolve(result.value)
                    }
                }
                else
                    resolve(line)
            }
            else {
                if (result !== undefined)
                    console.log(result)
                process.stdout.write(prompt)
            }
        }
        process.stdin.on('data', func)
    })

    /**
     * Prompts for a description, allowing it to be inputted inline or in the form of an input file, does not return until a description is given.
     * @param {String} prompt eg "Enter snip description: "
     * @returns 
     */
    const getDescription = prompt => new Promise(async resolve => {
        const description = await getInput(prompt.includes(':') ? `${prompt.slice(0, prompt.lastIndexOf(':'))} (leave blank to edit using file)${prompt.slice(prompt.lastIndexOf(':'))}` : `${prompt}(leave blank to edit using file)`)
        if (description !== '')
            resolve(description)
        else {
            process.stdout.write('Write the description in "snip_description.md" and save to submit.')
            const descriptionFile = path.join(process.cwd(), 'snip_description.md')
            fs.writeFileSync(descriptionFile, '', 'utf8')
            const watcher = chokidar.watch(descriptionFile)
            watcher.on('all', eventName => {
                if (eventName === 'unlink')
                    fs.writeFileSync(descriptionFile, '', 'utf8')
                if (eventName === 'change') {
                    const description = fs.readFileSync(descriptionFile, 'utf8')
                    if (description.split('\r\n').every(line => line.trim() === ''))
                        process.stdout.write('\nYou must enter a description.')
                    else {
                        watcher.close()
                        setTimeout(() => fs.rmSync(descriptionFile), 100)
                        process.stdout.write('\n')
                        resolve(description)
                    }
                }
            })
        }
    })

    const getSnipContent = (prompt, language) => new Promise(async resolve => {
        process.stdout.write(prompt)
        const snipFile = path.join(process.cwd(), `snip_content.${language}`)
        fs.writeFileSync(snipFile, '', 'utf8')
        const watcher = chokidar.watch(snipFile)
        watcher.on('all', eventName => {
            if (eventName === 'unlink')
                fs.writeFileSync(snipFile, '', 'utf8')
            if (eventName === 'change') {
                const content = fs.readFileSync(snipFile, 'utf8')
                if (content.split('\r\n').every(line => line.trim() === ''))
                    process.stdout.write('\nYou must enter content.')
                else {
                    watcher.close()
                    process.stdout.write('\n')
                    resolve()
                }
            }
        })
    })

    /**
     * Prompts for all node, npm, and snip dependencies.
     * @returns {Object} { nodeDependencies, npmDependencies, snipDependencies }
     */
    const getDependencies = async (type, language, id) => {
        const nodeDependencies = []
        const npmDependencies = []
        const snipDependencies = []
        while (true) {
            const id = await getInput('Enter node dependency id (leave blank to continue): ', line => {
                if (line === '')
                    return true
                if (nodeDependencies.includes(line))
                    return `You already have ${line} as a dependency.`
                if (!builtinModules.includes(line))
                    return `No node module found with id ${line}.`
                return true
            })
            if (id === '') break
            nodeDependencies.push(id)
        }
        while (true) {
            const id = await getInput('Enter npm dependency id (leave blank to continue): ', line => {
                if (line === '')
                    return true
                if (npmDependencies.map(entry => entry.id).includes(line))
                    return `You already have ${line} as a dependency.`
                try {
                    execSync(`npm view ${line} version`)
                }
                catch (e) {
                    return `No npm package found with id ${line}.`
                }
                return true
            })
            if (id === '') break
            const version = await getInput('Enter dependency version (leave blank for latest version): ', line => {
                if (line === '')
                    return { pass: true, value: execSync(`npm show ${id} version`).toString().trim(), show: true }
                try {
                    execSync(`npm view ${id}@${line} version`, { stdio: 'ignore' })
                }
                catch (e) {
                    return `No npm package found named ${id} with version ${line}.`
                }
                return true

            })
            npmDependencies.push({ id, version })
        }
        label: while (true) {
            while (true) {
                if (index.module && Object.keys(index.module).map(subLanguage => Object.keys(index.module[subLanguage]).map(subId => ({ language: subLanguage, id: subId }))).flat(Infinity).filter(entry => type !== 'module' || entry.language !== language || entry.id !== id).filter(entry => !snipDependencies.some(subEntry => entry.language === subEntry.language && entry.id === subEntry.id)).length) {
                    const validSnips = Object.keys(index.module).map(subLanguage => Object.keys(index.module[subLanguage]).map(subId => ({ language: subLanguage, id: subId }))).flat(Infinity).filter(entry => type !== 'module' || entry.language !== language || entry.id !== id).filter(entry => !snipDependencies.some(subEntry => entry.language === subEntry.language && entry.id === subEntry.id))
                    const validLanguages = validSnips.map(entry => entry.language).filter((item, index, arr) => arr.indexOf(item) === index)
                    const language = await getInput('Enter snip dependency language (leave blank to continue): ', line => {
                        if (line === '')
                            return true
                        if (!validLanguages.includes(line))
                            return `No module snips with language ${line} exist, valid languages are ${listify(validLanguages)}.`
                        return true
                    })
                    if (language === '') break label
                    const validIds = validSnips.filter(entry => entry.language === language).filter((item, index, arr) => arr.indexOf(item) === index).map(entry => entry.id)
                    const id = validIds.length === 1 ? validIds[0] : await getInput('Enter snip dependency id: ', line => {
                        if (!validIds.includes(language))
                            return `No module snips with language ${language} and id ${line} exist, valid ids are ${listify(validIds)}.`
                        return true
                    })
                    if (validIds.length === 1)
                        console.log(`Enter snip dependency id: ${validIds[0]}`)
                    const validVersions = sortVersions(Object.keys(index.module[language][id].versions))
                    const version = validVersions.length === 1 ? validVersions[0] : validVersions.length === 1 ? validVersions[0] : await getInput('Enter dependency version (or leave blank for latest): ', line => {
                        if (line === '')
                            return { pass: true, value: sortVersions(validVersions)[0], show: true }
                        if (index.module[language][id].versions[line] === undefined)
                            return `Invalid version, valid versions are ${listify(validVersions, true)}`
                        return true
                    })
                    if (validVersions.length === 1)
                        console.log(`Enter dependency version: ${validVersions[0]}`)

                    snipDependencies.push({ id, language, version })
                }
                else
                    break label
            }
        }
        const dependencies = {}
        if (nodeDependencies.length) dependencies.node = nodeDependencies
        if (Object.keys(npmDependencies).length) dependencies.npm = npmDependencies
        if (Object.keys(snipDependencies).length) dependencies.snip = snipDependencies
        return Object.keys(dependencies).length ? dependencies : false
    }

    const getTags = async validTags => {
        const tags = []
        while (true) {
            const tag = await getInput('Enter next tag (leave blank to continue): ', line => {
                if (validTags) {
                    if (line === '')
                        return true
                    if (!validTags.includes(line))
                        return `Invalid tag, valid tags are ${listify(validTags)}.`
                }
                return true
            })
            if (tag === '') break
            else if (!tags.includes(tag)) {
                tags.push(tag)
                if (validTags)
                    validTags.splice(validTags.indexOf(tag), 1)
            }
        }
        return tags
    }

    /**
     * Saves a snip to file and index, initiating as needed, handles updating vs creating differences.
     * @param {String} type 
     * @param {String} id 
     * @param {String} name 
     * @param {String} message 
     * @param {Object} dependencies 
     * @param {String} snipPath Where to copy the snip from.
     * @param {String} version 
     */
    const saveSnip = (type, language, id, name, message, dependencies, snipPath, version, description) => {
        const folderPath = path.join(__dirname, 'data', type, language, id)
        const versionPath = path.join(folderPath, 'versions', version)
        const isFirstVersion = !fs.existsSync(folderPath)
        const isFirstOfLanguage = !fs.existsSync(path.join(__dirname, 'data', type, language))
        const isFirstOfType = !fs.existsSync(path.join(__dirname, 'data', type))
        fs.mkdirSync(versionPath, { recursive: true })
        try {
            if (fs.statSync(snipPath).isDirectory())
                fs.cpSync(snipPath, path.join(versionPath, 'content'), { recursive: true })
            else
                fs.copyFileSync(snipPath, path.join(versionPath, `content.${language}`))
            if (dependencies)
                fs.writeFileSync(path.join(versionPath, 'dependencies.json'), JSON.stringify(dependencies, undefined, 4), 'utf8')
            if (isFirstVersion) {
                fs.writeFileSync(path.join(folderPath, 'name.txt'), name, 'utf8')
                fs.writeFileSync(path.join(folderPath, 'description.md'), message, 'utf8')
                fs.writeFileSync(path.join(versionPath, 'changelog.md'), 'First save', 'utf8')
            }
            else
                fs.writeFileSync(path.join(versionPath, 'changelog.md'), message, 'utf8')
            const now = new Date().toUTCString()
            fs.writeFileSync(path.join(versionPath, 'date.txt'), now, 'utf8')
            if (isFirstOfType)
                index[type] = {}
            if (isFirstOfLanguage)
                index[type][language] = {}
            if (isFirstVersion)
                index[type][language][id] = {
                    versions: {},
                    name,
                    description: message
                }
            index[type][language][id].versions[version] = {
                ...(dependencies ? { dependencies } : {}),
                date: now,
                changelog: isFirstVersion ? 'First save' : message
            }
            if (description !== undefined) {
                fs.writeFileSync(path.join(folderPath, 'description.md'), description, 'utf8')
                index[type][language][id].description = description
            }
            fs.writeFileSync(path.join(__dirname, 'index.json'), JSON.stringify(index, undefined, 4), 'utf8')
        }
        catch (err) {
            try {
                fs.rmSync(isFirstOfType ? path.join(__dirname, 'data', type) : isFirstOfLanguage ? path.join(__dirname, 'data', type, language) : isFirstVersion ? folderPath : versionPath, { recursive: true, force: true })
            } catch (e) { }
            throw new Error(`Error copying snip: ${err}`)
        }
    }

    const saveTags = (type, language, id, tags) => {
        const tagsPath = path.join(__dirname, 'data', type, language, id, 'tags.json')
        if (tags.length) {
            index[type][language][id].tags = tags
            fs.writeFileSync(tagsPath, JSON.stringify(tags), 'utf8')
        }
        else {
            if (fs.existsSync(tagsPath))
                fs.rmSync(tagsPath)
            if (index[type][language][id].tags !== undefined)
                delete index[type][language][id].tags
        }
        fs.writeFileSync(path.join(__dirname, 'index.json'), JSON.stringify(index, undefined, 4), 'utf8')
    }

    const listify = (arr, useAnd) => {
        if (!arr.length) return ''
        if (arr.length === 1) return arr[0]
        if (arr.length === 2) return `${arr[0]} ${useAnd ? 'and' : 'or'} ${arr[1]}`
        return arr.reduce((prev, item, index) => index ? `${prev}, ${index === arr.length - 1 ? useAnd ? 'and ' : 'or ' : ''}${item}` : item, '')
    }

    const getSnipPath = async getVersion => {
        const validTypes = Object.keys(index)
        const type = validTypes.length === 1 ? validTypes[0] : await getInput('Snip type: ', line => validTypes.includes(line) ? true : `There are no saved snips of that type, valid types are ${listify(validTypes)}.`)
        if (validTypes.length === 1) console.log(`Snip type: ${type}`)
        const validLanguages = Object.keys(index[type])
        const language = validLanguages.length === 1 ? validLanguages[0] : await getInput('Snip language file extension: ', line => validLanguages.includes(line) ? true : `There are no saved snips of that type and language, valid language file extensions are ${listify(validLanguages)}.`)
        if (validLanguages.length === 1) console.log(`Snip language file extension: ${language}`)
        const validIds = Object.keys(index[type][language])
        const id = validIds.length === 1 ? validIds[0] : await getInput('Snip id: ', line => validIds.includes(line) ? true : `There are no saved snips of that type, language, and id, valid ids are ${listify(validIds)}.`)
        if (validIds.length === 1) console.log(`Snip id: ${id}`)
        if (getVersion) {
            const validVersions = sortVersions(Object.keys(index[type][language][id].versions))
            const version = validVersions.length === 1 ? validVersions[0] : await getInput('Snip version (leave blank for latest): ', line => {
                if (line === '')
                    return { pass: true, value: validVersions[0], show: true }
                if (!validVersions.includes(line))
                    return `There are no saved snips of that type, language, id, and version, valid versions are ${listify(validVersions)}.`
                return true
            })
            if (validVersions.length === 1) console.log(`Snip version: ${version}`)
            return { type, language, id, version }
        }
        return { type, language, id }
    }

    const loadSnipModule = (language, id, version, isDependent = false) => {
        console.log(`Installing snip module ${id}@${version} (${language})${isDependent ? 'as dependency' : ''}`)
        const toPath = path.join(process.cwd(), 'snips', language, id)
        const fromPath = path.join(__dirname, 'data', 'module', language, id)
        const fromVersionPath = path.join(fromPath, 'versions', version)
        fs.mkdirSync(toPath, { recursive: true })
        fs.copyFileSync(path.join(fromVersionPath, `content.${language}`), path.join(toPath, `${id}.${language}`))
        fs.copyFileSync(path.join(fromPath, 'description.md'), path.join(toPath, 'description.md'))
        if (!isDependent)
            fs.writeFileSync(path.join(toPath, 'wasManuallyInstalled'), 'Yes', 'utf8')
        const dependencies = index.module[language][id].versions[version].dependencies ?? {}
        if (dependencies.npm)
            for (const npmModule of dependencies.npm) {
                console.log(`Installing ${npmModule.id}@${npmModule.version} as dependency.`)
                execSync(`npm install -y ${npmModule.id}@${npmModule.version}`, { stdio: 'inherit' })
            }
        if (dependencies.snips)
            for (const snipModule of dependencies.snips)
                loadSnipModule(snipModule.label, snipModule.id, snipModule.version, true)
    }

    const sortVersions = versions => versions.sort((a, b) => (Number(b.match(/^([0-9]+)\.[0-9]+\.[0-9]+$/)[1].padStart(5, '0')) * 10 ** 10 + Number(b.match(/^[0-9]+\.([0-9]+)\.[0-9]+$/)[1].padStart(5, '0')) * 10 ** 5 + Number(b.match(/^[0-9]+\.[0-9]+\.([0-9]+)$/)[1].padStart(5, '0'))) - (Number(a.match(/^([0-9]+)\.[0-9]+\.[0-9]+$/)[1].padStart(5, '0')) * 10 ** 10 + Number(a.match(/^[0-9]+\.([0-9]+)\.[0-9]+$/)[1].padStart(5, '0')) * 10 ** 5 + Number(a.match(/^[0-9]+\.[0-9]+\.([0-9]+)$/)[1].padStart(5, '0'))))

    const holdTheS = i => i === 1 ? '' : 's'

    const index = JSON.parse(fs.readFileSync(path.join(__dirname, 'index.json'), 'utf8'))

    const command = process.argv[2]
    const subCommand = process.argv[3]
    if (command === 'create') {
        console.log('Enter snip info:')
        const type = await getInput('Snip type: ', line => {
            if (!snipTypes.includes(line))
                return `Invalid type, valid types are ${listify(snipTypes)}.`
            return true
        })
        const language = await getInput('Snip language file extension: ', line => {
            if (line === '')
                return `Snip must have a language defined.`
            if (/[^a-z]/i.test(line))
                return `"${line}" is not a valid language name, language file extension names can only contain lowercase letters.`
            return true
        })
        const name = await getInput('Snip name: ', line => {
            if (line.trim() === '')
                return 'Snip must have a name.'
            let otherId
            if (index[type]?.[language] !== undefined && Object.keys(index[type][language]).some(id => {
                if (index[type][language][id].name === line) {
                    otherId = id
                    return true
                }
            }))
                return `Snip of that type and language already exists with that name: ${line} (${otherId}).`
            return true
        })
        const id = await getInput('Snip id: ', line => {
            if (line.trim() === '')
                return 'Snip must have an id.'
            if (/[^a-z0-9_-]/i.test(line))
                return 'Snip ids can only contain letters, numbers, dashes, or underscores.'
            if (index[type]?.[language]?.[line] !== undefined)
                return `Snip of that type and language already exists with that name: ${index[type][language][line].name} (${line}).`
            return true
        })
        const description = await getDescription('Enter snip description: ')
        console.log('Enter snip dependencies:')
        const dependencies = await getDependencies()
        const snipPath = await (async () => {
            if (!['folder', 'module'].includes(type)) {
                await getSnipContent(`Enter ${type} contents in the snip_content.${language} file, then save to submit.`, language)
                return path.join(process.cwd(), `snip_content.${language}`)
            }
            const snipPathPrompt = {
                module: 'Enter module path: ',
                folder: 'Enter folder path (leave blank for current folder): '
            }[type]
            return await getInput(snipPathPrompt, line => {
                if (!path.isAbsolute(line))
                    line = path.join(process.cwd(), line)
                if (!(fs.existsSync(line) && fs.statSync(line)[type === 'folder' ? 'isDirectory' : 'isFile']()))
                    return `No ${type === 'folder' ? 'folder' : 'file'} found at ${line}`
                return { pass: true, value: line, show: true }
            })
        })()
        console.log('Saving snip...')
        saveSnip(type, language, id, name, description, dependencies, snipPath, '1.0.0')
        if (!['folder', 'module'].includes(type))
            fs.rmSync(snipPath)
        const tags = await getTags()
        saveTags(type, language, id, tags)
        console.log('Snip created.')
    }
    else if (command === 'tags') {
        if (Object.keys(index).length) {
            if (!['get', 'set', 'add', 'remove', 'list'].includes(subCommand))
                console.error('Invalid command, valid commands are tags get, tags set, tags add, tags remove, or tags list.')
            else {
                if (['get', 'remove', 'list'].includes(subCommand) && !Object.keys(index).map(type => Object.keys(index[type]).map(language => Object.keys(index[type][language]).map(id => index[type][language][id].tags ?? []))).flat(Infinity).length)
                    console.log('No saved snips have any tags.')
                else {
                    if (subCommand === 'list') {
                        let tags = {}
                        for (const type of Object.values(index))
                            for (const ext of Object.values(type))
                                for (const id of Object.values(ext))
                                    for (const tag of id.tags)
                                        if (tags[tag])
                                            tags[tag]++
                                        else
                                            tags[tag] = 1
                        tags = Object.entries(tags)
                        const sortFunc = { a: (a, b) => a[0].localeCompare(b[0]), c: (a, b) => b[1] - a[1] }[(await getInput('Sort mode? [A]lphabetically, [C]ount: ', line => ['a', 'c'].includes(line.toLowerCase()) ? true : 'Invalid option, valid options are [A]lphabetically or [C]ount')).toLowerCase()]
                        console.log(`There are ${tags.length} snip${holdTheS(tags.length)} (with ${tags.reduce((prev, tag) => prev + tag[1], 0)} use${holdTheS(tags.reduce((prev, tag) => prev + tag[1], 0))}):`)
                        tags.sort(sortFunc)
                        for (const tag of tags)
                            console.log(` * ${tag[0]} : ${tag[1]}`)
                    }
                    else {
                        console.log('Select snip:')
                        const { type, language, id } = await getSnipPath()
                        const tags = index[type][language][id].tags ?? []
                        if (subCommand === 'get') {
                            if (tags.length)
                                console.log(`Snip has ${tags.length} tag${holdTheS(tags.length)}: ${listify(tags, true)}.`)
                            else
                                console.log('Snip has no tags.')
                        }
                        else if (subCommand === 'set') {
                            console.log('Enter new tags:')
                            const tags = await getTags()
                            saveTags(type, language, id, tags)
                            console.log(`Snip's tags set to ${listify(tags, true)}.`)
                        }
                        else if (subCommand === 'add') {
                            console.log('Enter tags to add:')
                            const tagsToAdd = (await getTags()).filter(tag => !tags.includes(tag))
                            if (tagsToAdd.length) {
                                tags.push(...tagsToAdd)
                                saveTags(type, language, id, tags)
                                console.log(`Added ${tagsToAdd.length} tag${holdTheS(tagsToAdd.length)}, setting the new tags to ${listify(tags, true)}.`)
                            }
                            else
                                console.log('No tags where entered to add.')
                        }
                        else if (subCommand === 'remove') {
                            if (!tags.length)
                                console.log('No tags to remove.')
                            else if (tags.length === 1) {
                                saveTags(type, language, id, [])
                                console.log('Removed the only tag.')
                            }
                            else {
                                console.log('Enter tags to remove:')
                                const tagsToRemove = await getTags(tags)
                                if (tagsToRemove.length) {
                                    tags.filter(tag => !tagsToRemove.includes(tag))
                                    saveTags(type, language, id, tags)
                                    if (tags.length)
                                        console.log(`Removed ${tagsToRemove.length} tag${holdTheS(tagsToRemove.length)}, setting the new tags to ${listify(tags, true)}.`)
                                    else
                                        console.log('Removed all tags.')
                                }
                                else
                                    console.log('No tags where entered to remove.')
                            }
                        }
                    }
                }
            }
        }
        else
            console.error('There are no saved snips.')

    }
    else if (command === 'delete') {
        if (Object.keys(index).length) {
            console.log('Select snip to delete:')
            const { type, language, id, version } = await getSnipPath(true)
            if ((await getInput('Are you sure you want to delete this snip version? (y/n): ', line => ['y', 'n'].includes(line.toLowerCase()))).toLowerCase() === 'y') {
                try {
                    const typePath = path.join(__dirname, 'data', type)
                    const languagePath = path.join(typePath, language)
                    const snipPath = path.join(languagePath, id)
                    const versionPath = path.join(__dirname, 'versions', version)
                    fs.rmSync(versionPath, { recursive: true, force: true })
                    delete index[type][language][id].versions[version]
                    if (!Object.keys(index[type][language][id].versions).length) {
                        fs.rmSync(snipPath, { recursive: true, force: true })
                        delete index[type][language][id]
                        if (!Object.keys(index[type][language]).length) {
                            fs.rmSync(languagePath, { recursive: true, force: true })
                            delete index[type][language]
                            if (!Object.keys(index[type]).length) {
                                fs.rmSync(typePath, { recursive: true, force: true })
                                delete index[type]
                            }
                        }
                    }
                    fs.writeFileSync(path.join(__dirname, 'index.json'), JSON.stringify(index, undefined, 4), 'utf8')
                    console.log('Snip deleted.')
                }
                catch (err) {
                    throw new Error(`There was an error while delete snip: ${err}`)
                }
            }
        }
        else
            console.error('There are no saved snips.')

    }
    else if (command === 'info') {
        if (Object.keys(index).length) {
            console.log('Select snip for info:')
            const { type, language, id, version } = await getSnipPath(true)
            const snip = index[type][language][id]
            const snipVersion = snip.versions[version]
            console.log(`\n${snip.name} (${id}):`)
            console.log(` * Type: ${type}`)
            console.log(` * Language file extension: ${language}`)
            console.log(` * Id: ${id}`)
            console.log(` * Name: ${snip.name}`)
            console.log(` * Description: ${[snip.description.slice(0, 50)].map(str => `${str}${str.length === 50 ? '...' : ''}`)[0]}`)
            console.log(` * Versions: ${Object.keys(snip.versions).length}`)
            console.log(` * Latest version: ${sortVersions(Object.keys(snip.versions))[0]}`)
            if (snipVersion.changelog !== undefined)
                console.log(` * Latest changelog: ${[snipVersion.changelog.slice(0, 50)].map(str => `${str}${str.length === 50 ? '...' : ''}`)[0]}`)
            console.log(` * First created: ${snip.date}`)
            console.log(` * Last updated: ${snip.versions[sortVersions(Object.keys(index[type][language][id].versions))[0]].date}`)
            if (snipVersion.dependencies !== undefined) {
                if (snipVersion.dependencies.node !== undefined)
                    console.log(` * Node dependencies: ${listify(snipVersion.dependencies.node, true)}`)
                if (snipVersion.dependencies.npm !== undefined)
                    console.log(` * Npm dependencies: ${listify(Object.keys(snipVersion.dependencies.npm).map(key => `${key}@${snipVersion.dependencies.npm[key]}`), true)}`)
                if (snipVersion.dependencies.snip !== undefined)
                    console.log(` * Snip dependencies: ${listify(Object.keys(snipVersion.dependencies.snip).map(key => `${key}@${snipVersion.dependencies.snip[key].version} (${snipVersion.dependencies.snip[key].language})`), true)}`)
            }
            if ((await getInput('Would you like to copy the description to a local file for viewing? (y/n): ', line => ['y', 'n'].includes(line.toLowerCase()))).toLowerCase() === 'y') {
                await new Promise(resolve => {
                    fs.cpSync(path.join(__dirname, 'data', type, language, id, 'description.md'), path.join(process.cwd(), `snip_description.md`))
                    const watcher = chokidar.watch(path.join(process.cwd(), `snip_description.md`))
                    watcher.on('all', eventName => {
                        if (eventName === 'change') {
                            setTimeout(() => fs.rmSync(path.join(process.cwd(), `snip_description.md`)), 250)
                            watcher.close()
                            resolve()
                        }
                        else if (eventName === 'unlink') {
                            watcher.close()
                            resolve()
                        }
                    })
                    console.log('File copied to snip_description.md, save the file to continue.')
                })
            }
            if (index[type][language][id].versions[version].changelog !== undefined) {
                console.log(`Target snips changelog:\n${index[type][language][id].versions[version].changelog}`)
                if ((await getInput('Would you like to copy the changelog to a local file for viewing? (y/n): ', line => ['y', 'n'].includes(line.toLowerCase()))).toLowerCase() === 'y') {
                    await new Promise(resolve => {
                        fs.cpSync(path.join(__dirname, 'data', type, language, id, 'versions', version, 'changelog.md'), path.join(process.cwd(), `snip_changelog.md`))
                        const watcher = chokidar.watch(path.join(process.cwd(), `snip_changelog.md`))
                        watcher.on('all', eventName => {
                            if (eventName === 'change') {
                                setTimeout(() => fs.rmSync(path.join(process.cwd(), `snip_changelog.md`)), 250)
                                watcher.close()
                                resolve()
                            }
                            else if (eventName === 'unlink') {
                                watcher.close()
                                resolve()
                            }
                        })
                        console.log('File copied to snip_changelog.md, save the file to continue.')
                    })
                }
            }
        }
        else
            console.error('There are no saved snips.')
    }
    else if (command === 'search') {
        if (Object.keys(index).length) {
            const filters = []
            const allSnips = Object.keys(index).map(type => Object.keys(index[type]).map(language => Object.keys(index[type][language]).map(id => Object.keys(index[type][language][id].versions).map(version => ({
                type,
                language,
                id,
                name: index[type][language][id].name,
                description: index[type][language][id].description,
                changelog: index[type][language][id].versions[version].changelog ?? '',
                date: index[type][language][id].versions[version].date,
                tags: index[type][language][id].tags ?? [],
                dependencies: index[type][language][id].versions[version].dependencies ?? {},
                version,
                isLatestVersion: sortVersions(Object.keys(index[type][language][id].versions))[0] === version
            }))))).flat(Infinity)
            const xor = (a, b) => (a || b) && !(a && b)
            const filterSnips = filters => allSnips.filter(snip => {
                for (const filter of filters) {
                    if (filter.mode === 'type' && xor(filter.inverse, snip.type !== filter.value)) return false
                    if (filter.mode === 'language' && xor(filter.inverse, snip.language !== filter.value)) return false
                    if (filter.mode === 'id' && xor(filter.inverse, snip.id !== filter.value)) return false
                    if (filter.mode === 'name' && xor(filter.inverse, snip.name !== filter.value)) return false
                    if (filter.mode === 'tag' && xor(filter.inverse, !snip.tags.includes(filter.value))) return false
                    if (filter.mode === 'version' && xor(filter.inverse, !(snip.version === filter.value || (snip.isLatestVersion && filter.value === 'latest')))) return false
                }
                return true
            })
            const allFilterValues = {
                type: allSnips.map(snip => snip.type),
                language: allSnips.map(snip => snip.language),
                id: allSnips.map(snip => snip.id),
                name: allSnips.map(snip => snip.name),
                tag: allSnips.map(snip => snip.tags).flat(),
                version: allSnips.map(snip => snip.version)
            }
            allFilterValues.version = ['latest', ...sortVersions(allFilterValues.version)]
            Object.keys(allFilterValues).forEach(key => allFilterValues[key] = allFilterValues[key].filter((val, index, arr) => arr.indexOf(val) === index).filter(value => filterSnips([{ mode: key, value }]).length !== allSnips.length))
            const filterModes = ['type', 'language', 'id', 'name', 'tag', 'version'].filter(mode => allFilterValues[mode].length > 1)
            while (true) {
                const filteredSnips = filterSnips(filters)
                if (!filterModes.length) {
                    console.log(`There ${filteredSnips.length === 1 ? 'is 1 result' : `are ${filteredSnips.length} results`} with no filters:`)
                    for (const snip of filteredSnips) {
                        console.log(`\n${snip.name} (${snip.id}) v${snip.version}${snip.isLatestVersion ? ' (latest)' : ''}:`)
                        console.log(` * Type: ${snip.type}`)
                        console.log(` * Language file extension: ${snip.language}`)
                        console.log(` * Id: ${snip.id}`)
                        console.log(` * Name: ${snip.name}`)
                        console.log(` * Description: ${[snip.description.slice(0, 50)].map(str => `${str}${str.length === 50 ? '...' : ''}`)[0]}`)
                        console.log(` * Changelog: ${[snip.changelog.slice(0, 50)].map(str => `${str}${str.length === 50 ? '...' : ''}`)[0]}`)
                        console.log(` * Version: ${snip.version}`)
                        console.log(` * Date created: ${snip.date}`)
                        console.log(` * Node dependencies: ${snip.dependencies.node ? listify(snip.dependencies.node, true) : ''}`)
                        console.log(` * Npm dependencies: ${snip.dependencies.npm ? listify(Object.keys(snip.dependencies.npm).map(key => `${key}@${snip.dependencies.npm[key]}`), true) : ''}`)
                        console.log(` * Snip dependencies: ${snip.dependencies.snip ? listify(Object.keys(snip.dependencies.snip).map(key => `${key}@${snip.dependencies.snip[key].version} (${snipVersion.dependencies.snip[key].language})`), true) : ''}`)
                    }
                    console.log('There are no applicable filters with the current snips.')
                    break
                }
                console.log(`\nThere ${filteredSnips.length === 1 ? 'is 1 result' : `are ${filteredSnips.length} results`} with the current filters:`)
                const next = (await getInput('Next action (leave blank to exit): ', line => {
                    if (line === '')
                        return true
                    if (!['a', 'r', 's', 'c'].includes(line.toLowerCase()))
                        return `Invalid command, valid commands are [A]dd filter, [R]emove filter, or [S]how results, [C]urrent filters.`
                    return true
                })).toLowerCase()
                if (next === '')
                    break
                else if (next === 'a') {
                    const mode = filterModes.length === 1 ? filterModes[0] : await getInput('Select filter mode: ', line => filterModes.includes(line) ? true : `Invalid mode, valid modes are ${listify(filterModes)}.`)
                    if (filterModes.length === 1) console.log(`Select filter mode: ${filterModes[0]}`)
                    const value = await getInput('Select filter value: ', line => allFilterValues[mode].includes(line) ? true : `Invalid value, valid values are ${listify(allFilterValues[mode])}.`)
                    const inverse = (await getInput('Invert filter?: ', line => ['y', 'n'].includes(line.toLowerCase()) ? true : 'Invalid answer, either [Y]es or [N]o.')).toLowerCase() === 'y'
                    filters.push({ mode, value, inverse })
                }
                else if (next === 'r') {
                    if (filters.length) {
                        if (filters.length === 1) {
                            filters.splice(0)
                            console.log('Removed the only filter.')
                        }
                        else {
                            console.log('Current filters:')
                            for (let index = 0; index < filters.length; index++)
                                console.log(` ${String(index + 1).padStart(Math.ceil(Math.log10(index + 1)), '0')}. ${filters[index].mode} ${filters[index].inverse ? '!' : ''}= ${filters[index].value}`)
                            const index = await getInput('Select filter to remove: ', line => Number(line) > 0 && Number(line) <= filters.length && !Number.isNaN(Number(line)) && Number(line) === Math.round(Number(line)) ? true : `Invalid filter index, enter an integer between 1 and ${filters.length}.`)
                            filters.splice(index, 1)
                        }
                    } else
                        console.log('There are no filters to remove.')
                }
                else if (next === 's') {
                    for (const snip of filteredSnips) {
                        console.log(`\n${snip.name} (${snip.id}) v${snip.version}${snip.isLatestVersion ? ' (latest)' : ''}:`)
                        console.log(` * Type: ${snip.type}`)
                        console.log(` * Language file extension: ${snip.language}`)
                        console.log(` * Id: ${snip.id}`)
                        console.log(` * Name: ${snip.name}`)
                        console.log(` * Description: ${[snip.description.slice(0, 50)].map(str => `${str}${str.length === 50 ? '...' : ''}`)[0]}`)
                        console.log(` * Changelog: ${[snip.changelog.slice(0, 50)].map(str => `${str}${str.length === 50 ? '...' : ''}`)[0]}`)
                        console.log(` * Version: ${snip.version}`)
                        console.log(` * Date created: ${snip.date}`)
                        console.log(` * Node dependencies: ${snip.dependencies.node ? listify(snip.dependencies.node, true) : ''}`)
                        console.log(` * Npm dependencies: ${snip.dependencies.npm ? listify(Object.keys(snip.dependencies.npm).map(key => `${key}@${snip.dependencies.npm[key]}`), true) : ''}`)
                        console.log(` * Snip dependencies: ${snip.dependencies.snip ? listify(Object.keys(snip.dependencies.snip).map(key => `${key}@${snip.dependencies.snip[key].version} (${snip.dependencies.snip[key].language})`), true) : ''}`)
                    }
                }
                else if (next === 'c')
                    if (filters.length) {
                        console.log('Current filters:')
                        for (let index = 0; index < filters.length; index++)
                            console.log(` ${String(index + 1).padStart(Math.ceil(Math.log10(index + 1)), '0')}. ${filters[index].mode} ${filters[index].inverse ? '!' : ''}= ${filters[index].value}`)
                    }
                    else
                        console.log('There are no current filters.')
            }
        }
        else
            console.log('There are no saved snips.')
    }
    else if (command === 'update') {
        console.log('Select snip to update:')
        const { type, language, id } = await getSnipPath()
        const changelog = await getDescription('Enter snip changelog: ')
        console.log('Enter snip dependencies:')
        const dependencies = await getDependencies()
        const version = await (async () => {
            const versionParts = sortVersions(Object.keys(index[type][language][id].versions))[0].split('.').map(i => Number(i))
            const updateType = await getInput('Enter update type: ', line => ['major', 'minor', 'bugfix'].includes(line) ? true : `Invalid type, valid types are ${listify(['major', 'minor', 'bugfix'])}.`)
            versionParts[['major', 'minor', 'bugfix'].indexOf(updateType)]++
            return versionParts.join('.')
        })()
        const snipPath = await (async () => {
            if (!['folder', 'module'].includes(type)) {
                await getSnipContent(`Enter ${type} contents in the snip_content.${language} file, then save to submit.`, language)
                return path.join(process.cwd(), `snip_content.${language}`)
            }
            const snipPathPrompt = {
                module: 'Enter module path: ',
                folder: 'Enter folder path (leave blank for current folder): '
            }[type]
            return await getInput(snipPathPrompt, line => {
                if (!path.isAbsolute(line))
                    line = path.join(process.cwd(), line)
                if (!(fs.existsSync(line) && fs.statSync(line)[type === 'folder' ? 'isDirectory' : 'isFile']()))
                    return `No ${type === 'folder' ? 'folder' : 'file'} found at ${line}`
                return { pass: true, value: line, show: true }
            })
        })()
        const description = ((await getInput('Would you like to update the description? (y/n): ', line => ['y', 'n'].includes(line.toLowerCase()))).toLowerCase() === 'y') ?
            await getDescription('Enter new snip description: ') :
            undefined

        console.log('Updating snip...')
        saveSnip(type, language, id, index[type][language][id].name, changelog, dependencies, snipPath, version, description)
        if (!['folder', 'module'].includes(type))
            fs.rmSync(snipPath)
        console.log(`Snip updated to version ${version}.`)
    }
    else if (command === 'install') {
        console.log('Select snip:')
        const { type, language, id, version } = await getSnipPath(true)
        if (type === 'folder') {
            console.log(`Copying snip folder to ${id}@${version}...`)
            fs.cpSync(path.join(__dirname, 'data', type, language, id, 'versions', version, 'content'), path.join(process.cwd(), `${id}@${version}`), { recursive: true, force: true })
            console.log('Done.')
        }
        else if (type === 'module') {
            loadSnipModule(language, id, version)
            console.log('Done.')
        }
        else
            await new Promise(async resolve => {
                const toPath = path.join(process.cwd(), `snip_${type}_${id}_${version}.${language}`)
                console.log(`Copying snip to ${toPath}`)
                fs.copyFileSync(path.join(__dirname, 'data', type, language, id, 'versions', version, `content.${language}`), toPath)
                const dependencies = index[type][language][id].versions[version].dependencies ?? {}
                if (dependencies.npm)
                    for (const npmModule of dependencies.npm) {
                        console.log(`Installing ${npmModule.id}@${npmModule.version} as dependency.`)
                        execSync(`npm install -y ${npmModule.id}@${npmModule.version}`, { stdio: 'inherit' })
                    }
                if (dependencies.snips)
                    for (const snipModule of dependencies.snips)
                        loadSnipModule(snipModule.label, snipModule.id, snipModule.version, true)
                const watcher = chokidar.watch(toPath)
                watcher.on('unlink', () => {
                    watcher.close()
                    resolve()
                })
                await getInput('Enter to continue: ')
                fs.rmSync(toPath)
                watcher.close()
                resolve()
                console.log('Done.')
            })
    }
    else
        console.log(`Invalid command, valid commands are ${listify(['create', 'tags', 'delete', 'info', 'search', 'update', 'install'], true)}.`)

    process.stdin.destroy()
})()