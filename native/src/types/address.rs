use postgis::ewkb::AsEwkbPoint;
use postgis::ewkb::EwkbWrite;

/// A representation of a single Address
pub struct Address {
    /// An optional identifier for the address
    pub id: Option<i64>,

    /// The address number, can be numeric or semi-numeric (100 vs 100a)
    pub number: String,

    /// Vector of all street name synonyms
    pub names: Vec<super::Name>,

    /// String source/provider/timestamp for the given data
    pub source: Option<String>,

    /// Should the feature be output
    pub output: bool,

    /// Should the address feature be used to generate interpolation
    pub interpolate: bool,

    /// JSON representation of properties
    pub props: serde_json::Map<String, serde_json::Value>,

    /// Simple representation of Lng/Lat geometry
    pub geom: (f64, f64)
}

impl Address {
    ///Return a PG Copyable String of the feature
    ///
    ///name, number, source, props, geom
    pub fn to_tsv(self) -> String {
        let geom = postgis::ewkb::Point::new(self.geom.0, self.geom.1, Some(4326)).as_ewkb().to_hex_ewkb();

        format!("{names}\t{number}\t{source}\t{props}\t{geom}\n",
            names = serde_json::to_string(&self.names).unwrap_or(String::from("")),
            number = self.number,
            source = self.source.as_ref().unwrap_or(&String::from("")),
            props = serde_json::value::Value::from(self.props),
            geom = geom
        )
    }
}