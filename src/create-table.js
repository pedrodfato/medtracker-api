import {sql} from './db.js'

sql`
CREATE TABLE medications (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    dosage VARCHAR(100) NOT NULL,
    total_pills INTEGER NOT NULL,
    frequency_hours INTEGER NOT NULL,
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`.then(() => {
    console.log("Tabela Criada")
})