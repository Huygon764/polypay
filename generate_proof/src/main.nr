use poseidon::poseidon2::Poseidon2;

fn main(private_key: Field, nonce: Field, commitment: pub Field, nullifier: pub Field) {
    let c = Poseidon2::hash([private_key, nonce], 2);
    assert(c == commitment, "commitment mismatch");

    let n = Poseidon2::hash([private_key, commitment], 2);
    assert(n == nullifier, "nullifier mismatch");
}
