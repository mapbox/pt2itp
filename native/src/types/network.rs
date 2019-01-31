use postgis::ewkb::AsEwkbPoint;
use postgis::ewkb::EwkbWrite;

/// A representation of a single network
pub struct Network {
    /// An optional identifier for the network
    pub id: Option<i64>,

    /// Vector of all street name synonyms
    pub names: Vec<super::Name>,

    /// String source/provider/timestamp for the given data
    pub source: Option<String>,

    /// JSON representation of properties
    pub props: serde_json::Map<String, serde_json::Value>,

    /// Simple representation of MultiLineString
    pub geom: Vec<Vec<(f64, f64)>>
}

impl Network {
    ///Return a PG Copyable String of the feature
    ///
    ///names, source, props, geom
    pub fn to_tsv(self) -> String {

        //TODO use multilinestring geom
        let geom = postgis::ewkb::Point::new(0.0, 0.0, Some(4326)).as_ewkb().to_hex_ewkb();

        format!("{names}\t{source}\t{props}\t{geom}\n",
            names = serde_json::to_string(&self.names).unwrap_or(String::from("")),
            source = self.source.as_ref().unwrap_or(&String::from("")),
            props = serde_json::value::Value::from(self.props),
            geom = geom
        )
    }
    
}