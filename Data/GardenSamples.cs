namespace Evergreen.Data;

public static class GardenSamples
{
    public static readonly string[] Categories = ["Succulents & dry", "Tropical, let top dry", "Tropical, evenly moist", "Mediterranean"];

    public static GardenSeed Create()
    {
        List<Place> places =
        [
            new("Mos Eisley South", "Bright, filtered", "20\u201323 \u00b0C", false, ""),
            new("Mos Eisley West", "Direct afternoon sun", "20\u201323 \u00b0C", false, ""),
            new("Panopticon", "Full sun", "Winter 5\u201312 \u00b0C", false, "PanopticonAdvice", "WinterTemperature"),
            new("Sweatshop", "Low light", "20\u201322 \u00b0C", false, ""),
            new("Garden", "Full sun to shade", "Outdoor", true, "", "Outdoor")
        ];
        places = places.Select((place, index) => place with { Id = $"sample-place-{index}" }).ToList();
        List<Plant> plants =
        [
            new("Ctenanthe", "Ctenanthe", "Mos Eisley South", Categories[2], "Normal", "Filtered", "images/Calathea_Golden_Mosaic.webp"),
            new("Dragon tree", "Dracaena marginata", "Mos Eisley South", Categories[1], "Small", "Bright", "images/dracaena.avif"),
            new("Monstera", "Monstera adansonii", "Mos Eisley South", Categories[1], "Small", "Bright", "images/monstera.webp"),
            new("Anthurium pink", "Anthurium", "Mos Eisley South", Categories[2], "Normal", "Filtered", "images/AuthirumPinkAmber_medium_mustard_yellow.webp"),
            new("Anthurium white", "Anthurium", "Mos Eisley South", Categories[2], "Normal", "Filtered", "images/167-S-ANTSWD-TRQ34G_884701dd-0b2b-4412-93a0-f3bdfcc02dae.webp"),
            new("Rubber plant", "Ficus elastica", "Mos Eisley South", Categories[1], "Small", "Bright", ""),
            new("Polka dot plant", "Hypoestes phyllostachya", "Mos Eisley South", Categories[2], "Normal", "Filtered", ""),
            new("White philodendron", "Philodendron", "Mos Eisley South", Categories[1], "Small", "Bright", ""),
            new("Aloe vera", "Aloe barbadensis", "Mos Eisley West", Categories[0], "Sip, only if bone dry", "Sun", "images/aloevera.webp"),
            new("Jade plant", "Crassula ovata", "Mos Eisley West", Categories[0], "Sip, only if bone dry", "Sun", ""),
            new("Spider plant", "Chlorophytum comosum", "Mos Eisley West", Categories[1], "Small", "Bright", ""),
            new("String of pearls", "Curio rowleyanus", "Mos Eisley West", Categories[0], "Sip, only if bone dry", "Sun", ""),
            new("Echeveria", "Echeveria", "Panopticon", Categories[0], "Sip, only if bone dry", "Sun", ""),
            new("Canary Island date palm", "Phoenix canariensis", "Panopticon", Categories[3], "Small", "Sun", ""),
            new("Lavender", "Lavandula", "Panopticon", Categories[3], "Small", "Sun", ""),
            new("Rosemary", "Salvia rosmarinus", "Panopticon", Categories[3], "Small", "Sun", ""),
            new("Stonecrop", "Sedum", "Panopticon", Categories[0], "Sip, only if bone dry", "Sun", ""),
            new("Lemon tree", "Citrus limon", "Panopticon", Categories[3], "Small", "Sun", ""),
            new("Dwarf fan palm", "Chamaerops humilis", "Panopticon", Categories[3], "Small", "Sun", ""),
            new("Chinese evergreen", "Aglaonema", "Sweatshop", Categories[1], "Small", "Low light", "images/Aglaonema_Siam_monet_grey.webp"),
            new("Snake plant", "Dracaena trifasciata", "Sweatshop", Categories[0], "Sip, only if bone dry", "Low light", "images/GoldenSnakePlantSmall_Reactive_Aqua.webp"),
            new("Peace lily", "Spathiphyllum", "Sweatshop", Categories[2], "Normal", "Filtered", "images/peace-lily.webp"),
            new("ZZ plant", "Zamioculcas zamiifolia", "Sweatshop", Categories[0], "Sip, only if bone dry", "Low light", "images/ZZ_plant_monet_blue.webp")
        ];
        for (var index = 0; index < plants.Count; index++)
        {
            plants[index].Id = $"sample-plant-{index}";
            plants[index].PlaceId = places.First(place => place.Name == plants[index].Location).Id;
        }
        List<JournalEntry> entries =
        [
            new("SkippedWednesdayTitle", "SkippedWednesdayDescription", "Watered", new(2026, 10, 14), 6),
            new("MovedPlantTitle", "MovedPlantDescription", "Repotted", new(2026, 10, 14), 5, "Polka dot plant"),
            new("JournalTreatedTitle", "TreatedPlantDescription", "Treated", new(2026, 10, 14), 4, "Ctenanthe"),
            new("JournalWateredTitle", "PlantNameDescription", "Watered", new(2026, 10, 11), 3, "Monstera"),
            new("JournalPhotoTitle", "NewFruitsDescription", "Photo", new(2026, 10, 11), 2, "Lemon tree"),
            new("WinterStartedTitle", "WinterStartedDescription", "Fertilized", new(2026, 10, 4), 1)
        ];
        entries = entries.Select((entry, index) => entry with
        {
            Id = $"sample-entry-{index}",
            PlantId = plants.FirstOrDefault(plant => plant.Name == entry.PlantName)?.Id ?? ""
        }).ToList();
        return new(plants, places, entries);
    }
}
