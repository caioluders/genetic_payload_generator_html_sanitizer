const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const { setTimeout } = require('node:timers/promises');

// Genetic Algorithm parameters
const POPULATION_SIZE = 10;
const MUTATION_RATE = 0.1;
const MAX_GENERATIONS = 100;

// Function to read HTML tags from file
async function readHTMLTags(filename) {
    const data = await fs.readFile(filename, 'utf8');
    return data.split('\n')
        .filter(line => line.trim() !== '')
        .map(tag => `<${tag}>`);
}

// Function to generate a random payload
function generatePayload(htmlTags) {
    const length = Math.floor(Math.random() * 10) + 1; // Random length between 1 and 10
    let payload = '';
    for (let i = 0; i < length; i++) {
        payload += htmlTags[Math.floor(Math.random() * htmlTags.length)];
    }
    return payload;
}

// Function to generate initial population
function generateInitialPopulation(htmlTags, size) {
    return Array(size).fill().map(() => generatePayload(htmlTags));
}

// Function to get the whole number of .result-item
async function getNumberOfResults(page) {
    const results = await page.evaluate(() => {
        const resultItems = document.querySelectorAll('#resultsContainer .result-item');
        return Array.from(resultItems).map(item => {
            const sanitizer = item.querySelector('h3').textContent.trim();
            const output = item.querySelector('pre').textContent.trim();
            return { sanitizer, output: output !== "error" && output !== "" ? output : null };
        }).filter(result => result.output !== null);
    });

    return results.length;
}

// Function to calculate fitness
async function calculateFitness(page, payload) {
    await page.evaluate((payload) => {
        document.querySelector('#multilineInput').value = payload;
        document.querySelector('button').click();
    }, payload);

    await setTimeout(600); // Add a 1-second sleep

    const results = await page.evaluate(() => {
        const resultItems = document.querySelectorAll('#resultsContainer .result-item');
        return Array.from(resultItems).map(item => {
            const sanitizer = item.querySelector('h3').textContent.trim();
            const output = item.querySelector('pre').textContent.trim();
            return { sanitizer, output: output !== "error" && output !== "" ? output : null };
        }).filter(result => result.output !== null);
    });
    // Log the results
    console.log(`Payload: ${payload}`);
    console.log('---');
    console.log('Sanitizer results:');
    results.forEach(result => {
        console.log(`${result.sanitizer}: ${result.output}`);
    });
    console.log('---');

    // Count unique outputs
    const uniqueOutputs = new Set(results.map(result => result.output));
    return uniqueOutputs.size;
}

// Function to select parents
function selectParents(population, fitnesses) {
    const totalFitness = fitnesses.reduce((a, b) => a + b, 0);
    const parent1Index = weightedRandomChoice(fitnesses, totalFitness);
    let parent2Index;
    do {
        parent2Index = weightedRandomChoice(fitnesses, totalFitness);
    } while (parent2Index === parent1Index);

    return [population[parent1Index], population[parent2Index]];
}

// Helper function for weighted random choice
function weightedRandomChoice(weights, totalWeight) {
    let random = Math.random() * totalWeight;
    for (let i = 0; i < weights.length; i++) {
        random -= weights[i];
        if (random <= 0) {
            return i;
        }
    }
    return weights.length - 1;
}

// Function to perform crossover
function crossover(parent1, parent2) {
    const crossoverPoint = Math.floor(Math.random() * Math.min(parent1.length, parent2.length));
    return parent1.slice(0, crossoverPoint) + parent2.slice(crossoverPoint);
}

// Function to perform mutation
function mutate(payload, htmlTags) {
    return payload.split('').map(char => 
        Math.random() < MUTATION_RATE ? htmlTags[Math.floor(Math.random() * htmlTags.length)] : char
    ).join('');
}

// Main genetic algorithm function
async function geneticAlgorithm(page, htmlTags, preFormedPayload) {
    let population;
    if (preFormedPayload) {
        // If a pre-formed payload is provided, use it as the first member of the population
        population = [preFormedPayload, ...generateInitialPopulation(htmlTags, POPULATION_SIZE - 1)];
        console.log("Starting with pre-formed payload:", preFormedPayload);
    } else {
        population = generateInitialPopulation(htmlTags, POPULATION_SIZE);
    }

    for (let generation = 0; generation < MAX_GENERATIONS; generation++) {
        console.log(`Generation ${generation + 1}`);
        // Calculate fitness for each payload sequentially
        const fitnesses = [];
        for (let i = 0; i < population.length; i++) {
            fitnesses.push(await calculateFitness(page, population[i]));
        }

        // Check if we've found a payload that differentiates all parsers
        const maxFitness = await getNumberOfResults(page);
        console.log(`Max fitness: ${maxFitness}`);
        if (maxFitness === fitnesses[0]) { // Assuming all pre tags represent different parsers
            const bestPayload = population[fitnesses.indexOf(maxFitness)];
            console.log(`Found optimal payload: ${bestPayload}`);
            return bestPayload;
        }

        // Create new population
        const newPopulation = [];
        while (newPopulation.length < POPULATION_SIZE) {
            const [parent1, parent2] = selectParents(population, fitnesses);
            let child = crossover(parent1, parent2);
            child = mutate(child, htmlTags);
            newPopulation.push(child);
        }

        population = newPopulation;
    }

    console.log("Max generations reached without finding optimal payload");
    return population[fitnesses.indexOf(Math.max(...fitnesses))];
}

// Main function
async function main() {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    const lab_url = process.argv.find(arg => arg.startsWith('--url=')).split('=')[1];
    await page.goto(lab_url);

    const htmlTagsFile = process.argv.find(arg => arg.startsWith('--html-tags=')).split('=')[1];
    const htmlTags = await readHTMLTags(htmlTagsFile);

    // Add this block to check for a pre-formed payload
    const preFormedPayload = process.argv.find(arg => arg.startsWith('--payload='))?.split('=')[1];

    const bestPayload = await geneticAlgorithm(page, htmlTags, preFormedPayload);

    await browser.close();
}

main().catch(console.error);
